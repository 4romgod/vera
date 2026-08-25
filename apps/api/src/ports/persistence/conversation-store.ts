import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from '../../domain/conversations/conversation.ts';

export type ConversationStore = {
  createConversation(
    conversation: Conversation,
  ): Promise<{ created: boolean; conversation: Conversation }>;
  findConversationById(
    principalId: string,
    conversationId: string,
  ): Promise<Conversation | null>;
  listConversations(principalId: string): Promise<ConversationSummary[]>;
  appendMessage(
    principalId: string,
    conversationId: string,
    message: ConversationMessage,
  ): Promise<{
    created: boolean;
    conversation: Conversation;
    message: ConversationMessage;
  }>;
  attachTaskToMessage(
    principalId: string,
    conversationId: string,
    messageId: string,
    taskId: string,
  ): Promise<Conversation>;
};
