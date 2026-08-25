import { randomUUID } from 'node:crypto';

import { ArtifactSchema, type Artifact } from '../domain/artifact.ts';
import {
  ConversationMessageSchema,
  ConversationSchema,
  type Conversation,
  type ConversationSummary,
} from '../domain/conversation.ts';
import { ProjectSchema, type Project } from '../domain/project.ts';
import type { ResourceStore } from '../ports/resource-store.ts';

export type ResourceErrorCode =
  | 'project_not_found'
  | 'conversation_not_found'
  | 'artifact_not_found'
  | 'idempotency_key_reused'
  | 'invalid_project_source';

export class ResourceError extends Error {
  public constructor(
    message: string,
    public readonly code: ResourceErrorCode,
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}

type IdFactory = (prefix: string) => string;
type Clock = () => string;

export type ResourceService = {
  registerProject(input: {
    principalId: string;
    registrationKey: string;
    displayName: string;
    rootPath: string;
  }): Promise<Project>;
  getProject(principalId: string, projectId: string): Promise<Project>;
  listProjects(principalId: string): Promise<Project[]>;
  createConversation(input: {
    principalId: string;
    creationKey: string;
    title?: string;
  }): Promise<Conversation>;
  getConversation(
    principalId: string,
    conversationId: string,
  ): Promise<Conversation>;
  listConversations(principalId: string): Promise<ConversationSummary[]>;
  appendOwnerMessage(input: {
    principalId: string;
    conversationId: string;
    requestKey: string;
    content: string;
    projectId?: string;
  }): Promise<{
    conversation: Conversation;
    messageId: string;
    taskId?: string;
  }>;
  attachTask(input: {
    principalId: string;
    conversationId: string;
    messageId: string;
    taskId: string;
  }): Promise<Conversation>;
  getArtifact(principalId: string, artifactId: string): Promise<Artifact>;
};

export function createResourceService(options: {
  store: ResourceStore;
  resolveLocalGitRoot(rootPath: string): Promise<string>;
  clock?: Clock;
  createId?: IdFactory;
}): ResourceService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  return {
    async registerProject(input) {
      let rootPath: string;
      try {
        rootPath = await options.resolveLocalGitRoot(input.rootPath);
      } catch (error) {
        void error;
        throw new ResourceError(
          'The project source must be an accessible canonical local Git repository root.',
          'invalid_project_source',
        );
      }
      const now = clock();
      const project = ProjectSchema.parse({
        schemaVersion: 1,
        id: createId('project'),
        principalId: input.principalId,
        registrationKey: input.registrationKey,
        displayName: input.displayName,
        normalizedName: input.displayName.trim().toLocaleLowerCase(),
        source: { kind: 'local_git', rootPath },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      const result = await options.store.createProject(project);
      if (
        !result.created &&
        (result.project.displayName !== project.displayName ||
          result.project.source.rootPath !== project.source.rootPath)
      ) {
        throw new ResourceError(
          `Idempotency key ${input.registrationKey} is already associated with different project input.`,
          'idempotency_key_reused',
        );
      }
      return result.project;
    },

    async getProject(principalId, projectId) {
      const project = await options.store.findProjectById(
        principalId,
        projectId,
      );
      if (project === null) {
        throw new ResourceError(
          `Project ${projectId} was not found.`,
          'project_not_found',
        );
      }
      return project;
    },

    listProjects: (principalId) => options.store.listProjects(principalId),

    async createConversation(input) {
      const now = clock();
      const conversation = ConversationSchema.parse({
        schemaVersion: 1,
        id: createId('conversation'),
        principalId: input.principalId,
        creationKey: input.creationKey,
        title: input.title ?? 'New conversation',
        status: 'active',
        messages: [],
        createdAt: now,
        updatedAt: now,
      });
      const result = await options.store.createConversation(conversation);
      if (!result.created && result.conversation.title !== conversation.title) {
        throw new ResourceError(
          `Idempotency key ${input.creationKey} is already associated with different conversation input.`,
          'idempotency_key_reused',
        );
      }
      return result.conversation;
    },

    async getConversation(principalId, conversationId) {
      const conversation = await options.store.findConversationById(
        principalId,
        conversationId,
      );
      if (conversation === null) {
        throw new ResourceError(
          `Conversation ${conversationId} was not found.`,
          'conversation_not_found',
        );
      }
      return conversation;
    },

    listConversations: (principalId) =>
      options.store.listConversations(principalId),

    async appendOwnerMessage(input) {
      if (input.projectId !== undefined) {
        const project = await options.store.findProjectById(
          input.principalId,
          input.projectId,
        );
        if (project === null) {
          throw new ResourceError(
            `Project ${input.projectId} was not found.`,
            'project_not_found',
          );
        }
      }
      const message = ConversationMessageSchema.parse({
        id: createId('message'),
        requestKey: input.requestKey,
        role: 'owner',
        content: input.content,
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        createdAt: clock(),
      });
      let result;
      try {
        result = await options.store.appendMessage(
          input.principalId,
          input.conversationId,
          message,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith(`Conversation ${input.conversationId}`)
        ) {
          throw new ResourceError(error.message, 'conversation_not_found');
        }
        throw error;
      }
      if (
        !result.created &&
        (result.message.content !== message.content ||
          result.message.projectId !== message.projectId)
      ) {
        throw new ResourceError(
          `Idempotency key ${input.requestKey} is already associated with different message input.`,
          'idempotency_key_reused',
        );
      }
      return {
        conversation: result.conversation,
        messageId: result.message.id,
        ...(result.message.taskId === undefined
          ? {}
          : { taskId: result.message.taskId }),
      };
    },

    attachTask: (input) =>
      options.store.attachTaskToMessage(
        input.principalId,
        input.conversationId,
        input.messageId,
        input.taskId,
      ),

    async getArtifact(principalId, artifactId) {
      const artifact = await options.store.findArtifactById(
        principalId,
        artifactId,
      );
      if (artifact === null) {
        throw new ResourceError(
          `Artifact ${artifactId} was not found.`,
          'artifact_not_found',
        );
      }
      return ArtifactSchema.parse(artifact);
    },
  };
}
