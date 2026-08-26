import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  ArtifactSchema,
  type Artifact,
} from '../../../../domain/artifacts/artifact.ts';
import {
  ConversationMessageSchema,
  ConversationSchema,
  ConversationSummarySchema,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
} from '../../../../domain/conversations/conversation.ts';
import {
  ProjectSchema,
  type Project,
} from '../../../../domain/projects/project.ts';
import type { OwnerResourceStore } from '../../../../ports/persistence/owner-resource-store.ts';
import {
  PersonalTaskSchema,
  type PersonalTask,
} from '../../../../domain/personal-tasks/personal-task.ts';
import { personalTaskMutationOrderKey } from '../../../../ports/persistence/personal-task-store.ts';
import {
  ReminderSchema,
  type NotificationResource,
  type Reminder,
} from '../../../../domain/reminders/reminder.ts';
import {
  notificationIdForReminder,
  reminderMutationOrderKey,
  type ReminderListStatus,
} from '../../../../ports/persistence/reminder-store.ts';

const PROJECTS = 'projects';
const CONVERSATIONS = 'conversations';
const ARTIFACTS = 'artifacts';
const PERSONAL_TASKS = 'personal_tasks';
const REMINDERS = 'reminders';

export type MongoDbOwnerResourceStoreOptions = {
  uri: string;
  database: string;
  timeoutMs: number;
  client?: MongoClient;
};

export class MongoDbOwnerResourceStore implements OwnerResourceStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly projects: Collection;
  private readonly conversations: Collection;
  private readonly artifacts: Collection;
  private readonly personalTasks: Collection;
  private readonly reminders: Collection;
  private connection: Promise<void> | undefined;

  public constructor(options: MongoDbOwnerResourceStoreOptions) {
    this.client =
      options.client ??
      new MongoClient(options.uri, {
        connectTimeoutMS: options.timeoutMs,
        serverSelectionTimeoutMS: options.timeoutMs,
        socketTimeoutMS: options.timeoutMs,
      });
    this.database = this.client.db(options.database);
    this.projects = this.database.collection(PROJECTS);
    this.conversations = this.database.collection(CONVERSATIONS);
    this.artifacts = this.database.collection(ARTIFACTS);
    this.personalTasks = this.database.collection(PERSONAL_TASKS);
    this.reminders = this.database.collection(REMINDERS);
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
        messages: {
          $not: {
            $elemMatch: {
              role: message.role,
              requestKey: message.requestKey,
            },
          },
        },
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
      (candidate) =>
        candidate.role === message.role &&
        candidate.requestKey === message.requestKey,
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

  public async createPersonalTask(task: PersonalTask): Promise<PersonalTask> {
    await this.ensureConnected();
    const validated = PersonalTaskSchema.parse(task);
    await this.personalTasks.updateOne(
      {
        principalId: validated.principalId,
        creationInvocationId: validated.creationInvocationId,
      },
      { $setOnInsert: validated },
      { upsert: true },
    );
    const stored = await this.findPersonalTaskByCreationInvocation(
      validated.principalId,
      validated.creationInvocationId,
    );
    if (stored === null) {
      throw new Error('MongoDB personal task create did not return a task.');
    }
    return stored;
  }

  public async listPersonalTasks(
    principalId: string,
    options: { status: 'all' | 'open' | 'completed'; limit: number },
  ): Promise<PersonalTask[]> {
    await this.ensureConnected();
    const documents = await this.personalTasks
      .find({
        principalId,
        ...(options.status === 'all' ? {} : { status: options.status }),
      })
      .sort({ updatedAt: -1, id: 1 })
      .limit(options.limit)
      .toArray();
    return documents.map((document) => this.parsePersonalTask(document));
  }

  public async setPersonalTaskStatus(input: {
    principalId: string;
    taskId: string;
    status: 'open' | 'completed';
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<PersonalTask | null> {
    await this.ensureConnected();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const currentDocument = await this.personalTasks.findOne({
        principalId: input.principalId,
        id: input.taskId,
      });
      if (currentDocument === null) return null;
      const current = this.parsePersonalTask(currentDocument);
      if (current.lastMutation.invocationId === input.invocationId) {
        return current;
      }
      const requestedOrderKey = personalTaskMutationOrderKey(
        input.mutationAt,
        input.invocationId,
      );
      if (input.recovery && current.lastMutation.orderKey > requestedOrderKey) {
        return current;
      }
      const mutationAt =
        current.updatedAt >= input.mutationAt
          ? new Date(Date.parse(current.updatedAt) + 1).toISOString()
          : input.mutationAt;
      const orderKey = personalTaskMutationOrderKey(
        mutationAt,
        input.invocationId,
      );
      const updated = await this.personalTasks.findOneAndUpdate(
        {
          principalId: input.principalId,
          id: input.taskId,
          'lastMutation.orderKey': current.lastMutation.orderKey,
        },
        {
          $set: {
            status: input.status,
            updatedAt: mutationAt,
            lastMutation: { invocationId: input.invocationId, orderKey },
            ...(input.status === 'completed'
              ? { completedAt: mutationAt }
              : {}),
          },
          ...(input.status === 'open' ? { $unset: { completedAt: '' } } : {}),
        },
        { returnDocument: 'after' },
      );
      if (updated !== null) return this.parsePersonalTask(updated);
    }
    throw new Error('Personal task changed too frequently to apply mutation.');
  }

  public async findPersonalTaskByCreationInvocation(
    principalId: string,
    invocationId: string,
  ): Promise<PersonalTask | null> {
    await this.ensureConnected();
    const document = await this.personalTasks.findOne({
      principalId,
      creationInvocationId: invocationId,
    });
    return document === null ? null : this.parsePersonalTask(document);
  }

  public async findPersonalTaskById(
    principalId: string,
    taskId: string,
  ): Promise<PersonalTask | null> {
    await this.ensureConnected();
    const document = await this.personalTasks.findOne({
      principalId,
      id: taskId,
    });
    return document === null ? null : this.parsePersonalTask(document);
  }

  public async createReminder(reminder: Reminder): Promise<Reminder> {
    await this.ensureConnected();
    const validated = ReminderSchema.parse(reminder);
    await this.reminders.updateOne(
      {
        principalId: validated.principalId,
        creationInvocationId: validated.creationInvocationId,
      },
      { $setOnInsert: validated },
      { upsert: true },
    );
    const stored = await this.findReminderByCreationInvocation(
      validated.principalId,
      validated.creationInvocationId,
    );
    if (stored === null) {
      throw new Error('MongoDB reminder create did not return a reminder.');
    }
    return stored;
  }

  public async findReminderByCreationInvocation(
    principalId: string,
    invocationId: string,
  ): Promise<Reminder | null> {
    await this.ensureConnected();
    const document = await this.reminders.findOne({
      principalId,
      creationInvocationId: invocationId,
    });
    return document === null ? null : this.parseReminder(document);
  }

  public async findReminderById(
    principalId: string,
    reminderId: string,
  ): Promise<Reminder | null> {
    await this.ensureConnected();
    const document = await this.reminders.findOne({
      principalId,
      id: reminderId,
    });
    return document === null ? null : this.parseReminder(document);
  }

  public async listReminders(
    principalId: string,
    options: { status: ReminderListStatus; limit: number },
  ): Promise<Reminder[]> {
    await this.ensureConnected();
    const documents = await this.reminders
      .find({
        principalId,
        ...(options.status === 'all' ? {} : { status: options.status }),
      })
      .sort({ scheduledFor: 1, id: 1 })
      .limit(options.limit)
      .toArray();
    return documents.map((document) => this.parseReminder(document));
  }

  public async mutateReminder(input: {
    principalId: string;
    reminderId: string;
    action:
      | {
          action: 'reschedule';
          reminderId: string;
          scheduledFor: string;
          timeZone: string;
        }
      | { action: 'cancel' | 'acknowledge'; reminderId: string };
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<Reminder | null> {
    await this.ensureConnected();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const document = await this.reminders.findOne({
        principalId: input.principalId,
        id: input.reminderId,
      });
      if (document === null) return null;
      const current = this.parseReminder(document);
      if (current.lastMutation.invocationId === input.invocationId) {
        return current;
      }
      const requestedOrderKey = reminderMutationOrderKey(
        input.mutationAt,
        input.invocationId,
      );
      if (input.recovery && current.lastMutation.orderKey > requestedOrderKey) {
        return current;
      }
      if (
        input.action.action !== 'acknowledge' &&
        current.status !== 'scheduled'
      ) {
        throw new Error(
          `Only a scheduled reminder can be ${input.action.action === 'cancel' ? 'cancelled' : 'rescheduled'}.`,
        );
      }
      if (
        input.action.action === 'acknowledge' &&
        (current.status !== 'delivered' || current.notification === undefined)
      ) {
        throw new Error('Only a delivered reminder can be acknowledged.');
      }
      const mutationAt =
        current.updatedAt >= input.mutationAt
          ? new Date(Date.parse(current.updatedAt) + 1).toISOString()
          : input.mutationAt;
      const orderKey = reminderMutationOrderKey(mutationAt, input.invocationId);
      const set: Record<string, unknown> = {
        updatedAt: mutationAt,
        lastMutation: { invocationId: input.invocationId, orderKey },
      };
      const unset: Record<string, ''> = {};
      if (input.action.action === 'reschedule') {
        set.scheduledFor = input.action.scheduledFor;
        set.timeZone = input.action.timeZone;
        unset.claim = '';
      } else if (input.action.action === 'cancel') {
        set.status = 'cancelled';
        set.cancelledAt = mutationAt;
        unset.claim = '';
      } else {
        set.status = 'acknowledged';
        set.acknowledgedAt = mutationAt;
        set['notification.status'] = 'acknowledged';
        set['notification.acknowledgedAt'] = mutationAt;
      }
      const updated = await this.reminders.findOneAndUpdate(
        {
          principalId: input.principalId,
          id: input.reminderId,
          'lastMutation.orderKey': current.lastMutation.orderKey,
          status:
            input.action.action === 'acknowledge' ? 'delivered' : 'scheduled',
          ...(input.action.action === 'acknowledge'
            ? { notification: { $exists: true } }
            : {}),
        },
        {
          $set: set,
          ...(Object.keys(unset).length === 0 ? {} : { $unset: unset }),
        },
        { returnDocument: 'after' },
      );
      if (updated !== null) return this.parseReminder(updated);
    }
    throw new Error('Reminder changed too frequently to apply mutation.');
  }

  public async claimDueReminder(input: {
    workerId: string;
    token: string;
    now: string;
    expiresAt: string;
  }): Promise<Reminder | null> {
    await this.ensureConnected();
    const document = await this.reminders.findOneAndUpdate(
      {
        status: 'scheduled',
        scheduledFor: { $lte: input.now },
        $or: [
          { claim: { $exists: false } },
          { 'claim.expiresAt': { $lte: input.now } },
        ],
      },
      {
        $set: {
          claim: {
            workerId: input.workerId,
            token: input.token,
            claimedAt: input.now,
            expiresAt: input.expiresAt,
          },
        },
      },
      { sort: { scheduledFor: 1, id: 1 }, returnDocument: 'after' },
    );
    return document === null ? null : this.parseReminder(document);
  }

  public async finalizeReminderDelivery(input: {
    principalId: string;
    reminderId: string;
    workerId: string;
    token: string;
    deliveredAt: string;
  }): Promise<Reminder | null> {
    await this.ensureConnected();
    const current = await this.findReminderById(
      input.principalId,
      input.reminderId,
    );
    if (current?.status === 'delivered' && current.notification !== undefined) {
      return current;
    }
    if (
      current?.status !== 'scheduled' ||
      current.claim?.workerId !== input.workerId ||
      current.claim.token !== input.token
    ) {
      return null;
    }
    const notification: NotificationResource = {
      schemaVersion: 1,
      id: notificationIdForReminder(current.id),
      reminderId: current.id,
      message: current.message,
      scheduledFor: current.scheduledFor,
      deliveredAt: input.deliveredAt,
      status: 'unread',
      channel: 'vera_inbox',
    };
    const updated = await this.reminders.findOneAndUpdate(
      {
        principalId: input.principalId,
        id: input.reminderId,
        status: 'scheduled',
        'claim.workerId': input.workerId,
        'claim.token': input.token,
      },
      {
        $set: {
          status: 'delivered',
          updatedAt: input.deliveredAt,
          notification,
        },
        $unset: { claim: '' },
      },
      { returnDocument: 'after' },
    );
    return updated === null ? null : this.parseReminder(updated);
  }

  public async releaseReminderClaim(input: {
    reminderId: string;
    workerId: string;
    token: string;
  }): Promise<void> {
    await this.ensureConnected();
    await this.reminders.updateOne(
      {
        id: input.reminderId,
        'claim.workerId': input.workerId,
        'claim.token': input.token,
      },
      { $unset: { claim: '' } },
    );
  }

  public async listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ): Promise<NotificationResource[]> {
    await this.ensureConnected();
    const after = options.after;
    const documents = await this.reminders
      .find({
        principalId,
        notification: { $exists: true },
        ...(after === undefined
          ? {}
          : {
              $or: [
                { 'notification.deliveredAt': { $gt: after.deliveredAt } },
                {
                  'notification.deliveredAt': after.deliveredAt,
                  'notification.id': { $gt: after.id },
                },
              ],
            }),
      })
      .sort({ 'notification.deliveredAt': 1, 'notification.id': 1 })
      .limit(options.limit)
      .toArray();
    return documents.map((document) => {
      const reminder = this.parseReminder(document);
      if (reminder.notification === undefined) {
        throw new Error('MongoDB notification projection is missing.');
      }
      return reminder.notification;
    });
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
      this.personalTasks.createIndex({ id: 1 }, { unique: true }),
      this.personalTasks.createIndex(
        { principalId: 1, creationInvocationId: 1 },
        { unique: true },
      ),
      this.personalTasks.createIndex({
        principalId: 1,
        status: 1,
        updatedAt: -1,
      }),
      this.reminders.createIndex({ id: 1 }, { unique: true }),
      this.reminders.createIndex(
        { principalId: 1, creationInvocationId: 1 },
        { unique: true },
      ),
      this.reminders.createIndex({
        status: 1,
        scheduledFor: 1,
        'claim.expiresAt': 1,
      }),
      this.reminders.createIndex({
        principalId: 1,
        'notification.deliveredAt': 1,
        'notification.id': 1,
      }),
    ]);
  }

  private withoutId(document: Document): Record<string, unknown> {
    const { _id: ignored, ...value } = document;
    void ignored;
    return value;
  }

  private parsePersonalTask(document: Document): PersonalTask {
    return PersonalTaskSchema.parse(this.withoutId(document));
  }

  private parseReminder(document: Document): Reminder {
    return ReminderSchema.parse(this.withoutId(document));
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
