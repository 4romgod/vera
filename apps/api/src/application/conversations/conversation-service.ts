import { randomUUID } from 'node:crypto';

import {
  ConversationMessageSchema,
  ConversationSchema,
  type Conversation,
  type ConversationSummary,
} from '../../domain/conversations/conversation.ts';
import type { ConversationStore } from '../../ports/persistence/conversation-store.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type ConversationService = {
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
};

export function createConversationService(options: {
  store: ConversationStore & ProjectStore;
  clock?: () => string;
  createId?: (prefix: string) => string;
}): ConversationService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  return {
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
  };
}
