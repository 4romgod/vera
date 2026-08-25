import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import { ArtifactSchema, type Artifact } from '../domain/artifact.ts';
import {
  ConversationMessageSchema,
  ConversationSchema,
  ConversationSummarySchema,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
} from '../domain/conversation.ts';
import { ProjectSchema, type Project } from '../domain/project.ts';
import type { ResourceStore } from '../ports/resource-store.ts';

const PROJECTS = 'projects';
const CONVERSATIONS = 'conversations';
const ARTIFACTS = 'artifacts';

export type MongoDbResourceStoreOptions = {
  uri: string;
  database: string;
  timeoutMs: number;
  client?: MongoClient;
};

export class MongoDbResourceStore implements ResourceStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly projects: Collection;
  private readonly conversations: Collection;
  private readonly artifacts: Collection;
  private connection: Promise<void> | undefined;

  public constructor(options: MongoDbResourceStoreOptions) {
    this.client =
      options.client ??
      new MongoClient(options.uri, {
        connectTimeoutMS: options.timeoutMs,
        serverSelectionTimeoutMS: options.timeoutMs,
      });
    this.database = this.client.db(options.database);
    this.projects = this.database.collection(PROJECTS);
    this.conversations = this.database.collection(CONVERSATIONS);
    this.artifacts = this.database.collection(ARTIFACTS);
  }

  public async createProject(
    project: Project,
  ): Promise<{ created: boolean; project: Project }> {
    await this.ensureConnected();
    const result = await this.projects.updateOne(
      {
        principalId: project.principalId,
        registrationKey: project.registrationKey,
      },
      { $setOnInsert: project },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      return { created: true, project };
    }
    const existing = await this.projects.findOne({
      principalId: project.principalId,
      registrationKey: project.registrationKey,
    });
    if (existing === null) {
      throw new Error(
        'MongoDB idempotent project create did not return a project.',
      );
    }
    return { created: false, project: this.parseProject(existing) };
  }

  public async findProjectById(
    principalId: string,
    projectId: string,
  ): Promise<Project | null> {
    await this.ensureConnected();
    const document = await this.projects.findOne({
      principalId,
      id: projectId,
    });
    return document === null ? null : this.parseProject(document);
  }

  public async listProjects(principalId: string): Promise<Project[]> {
    await this.ensureConnected();
    const documents = await this.projects
      .find({ principalId })
      .sort({ displayName: 1 })
      .toArray();
    return documents.map((document) => this.parseProject(document));
  }

  public async createConversation(
    conversation: Conversation,
  ): Promise<{ created: boolean; conversation: Conversation }> {
    await this.ensureConnected();
    const result = await this.conversations.updateOne(
      {
        principalId: conversation.principalId,
        creationKey: conversation.creationKey,
      },
      { $setOnInsert: conversation },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      return { created: true, conversation };
    }
    const existing = await this.conversations.findOne({
      principalId: conversation.principalId,
      creationKey: conversation.creationKey,
    });
    if (existing === null) {
      throw new Error(
        'MongoDB idempotent conversation create did not return a conversation.',
      );
    }
    return { created: false, conversation: this.parseConversation(existing) };
  }

  public async findConversationById(
    principalId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    await this.ensureConnected();
    const document = await this.conversations.findOne({
      principalId,
      id: conversationId,
    });
    return document === null ? null : this.parseConversation(document);
  }

  public async listConversations(
    principalId: string,
  ): Promise<ConversationSummary[]> {
    await this.ensureConnected();
    const documents = await this.conversations
      .aggregate([
        { $match: { principalId } },
        { $sort: { updatedAt: -1 } },
        {
          $project: {
            _id: 0,
            schemaVersion: 1,
            id: 1,
            title: 1,
            status: 1,
            messageCount: { $size: '$messages' },
            lastMessage: { $arrayElemAt: ['$messages', -1] },
            createdAt: 1,
            updatedAt: 1,
          },
        },
        { $unset: 'lastMessage.requestKey' },
      ])
      .sort({ updatedAt: -1 })
      .toArray();
    return documents.map((document) => {
      if (document.lastMessage === undefined) {
        delete document.lastMessage;
      }
      return ConversationSummarySchema.parse(document);
    });
  }

  public async appendMessage(
    principalId: string,
    conversationId: string,
    message: ConversationMessage,
  ): Promise<{
    created: boolean;
    conversation: Conversation;
    message: ConversationMessage;
  }> {
    await this.ensureConnected();
    const validatedMessage = ConversationMessageSchema.parse(message);
    const result = await this.conversations.updateOne(
      {
        principalId,
        id: conversationId,
        messages: { $not: { $elemMatch: { requestKey: message.requestKey } } },
      },
      {
        $push: { messages: validatedMessage },
        $set: { updatedAt: message.createdAt },
      } as Document,
    );
    const document = await this.conversations.findOne({
      principalId,
      id: conversationId,
    });
    if (document === null) {
      throw new Error(`Conversation ${conversationId} was not found.`);
    }
    const conversation = this.parseConversation(document);
    const storedMessage = conversation.messages.find(
      (candidate) => candidate.requestKey === message.requestKey,
    );
    if (storedMessage === undefined) {
      throw new Error('MongoDB message append did not return the message.');
    }
    return {
      created: result.modifiedCount === 1,
      conversation,
      message: storedMessage,
    };
  }

  public async attachTaskToMessage(
    principalId: string,
    conversationId: string,
    messageId: string,
    taskId: string,
  ): Promise<Conversation> {
    await this.ensureConnected();
    await this.conversations.updateOne(
      {
        principalId,
        id: conversationId,
        messages: {
          $elemMatch: {
            id: messageId,
            $or: [{ taskId: { $exists: false } }, { taskId }],
          },
        },
      },
      { $set: { 'messages.$[message].taskId': taskId } },
      { arrayFilters: [{ 'message.id': messageId }] },
    );
    const conversation = await this.findConversationById(
      principalId,
      conversationId,
    );
    const message = conversation?.messages.find(
      (candidate) => candidate.id === messageId,
    );
    if (conversation === null || message?.taskId !== taskId) {
      throw new Error(
        `Message ${messageId} could not be attached to task ${taskId}.`,
      );
    }
    return conversation;
  }

  public async createArtifact(
    artifact: Artifact,
  ): Promise<{ created: boolean; artifact: Artifact }> {
    await this.ensureConnected();
    const result = await this.artifacts.updateOne(
      {
        principalId: artifact.principalId,
        invocationId: artifact.invocationId,
      },
      { $setOnInsert: artifact },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      return { created: true, artifact };
    }
    const existing = await this.findArtifactByInvocationId(
      artifact.principalId,
      artifact.invocationId,
    );
    if (existing === null) {
      throw new Error(
        'MongoDB idempotent artifact create did not return an artifact.',
      );
    }
    return { created: false, artifact: existing };
  }

  public async findArtifactById(
    principalId: string,
    artifactId: string,
  ): Promise<Artifact | null> {
    await this.ensureConnected();
    const document = await this.artifacts.findOne({
      principalId,
      id: artifactId,
    });
    return document === null ? null : this.parseArtifact(document);
  }

  public async findArtifactByInvocationId(
    principalId: string,
    invocationId: string,
  ): Promise<Artifact | null> {
    await this.ensureConnected();
    const document = await this.artifacts.findOne({
      principalId,
      invocationId,
    });
    return document === null ? null : this.parseArtifact(document);
  }

  public async checkReadiness(): Promise<void> {
    await this.ensureConnected();
    await this.database.command({ ping: 1 });
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private ensureConnected(): Promise<void> {
    const connection = (this.connection ??= this.connect().catch(
      (error: unknown) => {
        this.connection = undefined;
        throw error;
      },
    ));
    return connection;
  }

  private async connect(): Promise<void> {
    await this.client.connect();
    await Promise.all([
      this.projects.createIndex({ id: 1 }, { unique: true }),
      this.projects.createIndex(
        { principalId: 1, registrationKey: 1 },
        { unique: true },
      ),
      this.projects.createIndex({ principalId: 1, normalizedName: 1 }),
      this.conversations.createIndex({ id: 1 }, { unique: true }),
      this.conversations.createIndex(
        { principalId: 1, creationKey: 1 },
        { unique: true },
      ),
      this.conversations.createIndex({ principalId: 1, updatedAt: -1 }),
      this.artifacts.createIndex({ id: 1 }, { unique: true }),
      this.artifacts.createIndex(
        { principalId: 1, invocationId: 1 },
        { unique: true },
      ),
    ]);
  }

  private withoutId(document: Document): Record<string, unknown> {
    const { _id: ignored, ...value } = document;
    void ignored;
    return value;
  }

  private parseProject(document: Document): Project {
    return ProjectSchema.parse(this.withoutId(document));
  }

  private parseConversation(document: Document): Conversation {
    return ConversationSchema.parse(this.withoutId(document));
  }

  private parseArtifact(document: Document): Artifact {
    return ArtifactSchema.parse(this.withoutId(document));
  }
}
