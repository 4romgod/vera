import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { assembleConversationContext } from './assemble-conversation-context.ts';
import {
  ConversationContextBundleSchema,
  type ConversationContextBundle,
} from '../domain/conversation-context.ts';
import type { Conversation } from '../domain/conversation.ts';

export function assertConversationContextIntegrity(
  value: ConversationContextBundle,
  expected: {
    conversationId: string;
    throughMessageId: string;
    projectId?: string;
    conversation: Conversation;
  },
): void {
  const context = ConversationContextBundleSchema.parse(value);
  const { manifest, messages } = context;
  if (
    manifest.conversationId !== expected.conversationId ||
    manifest.throughMessageId !== expected.throughMessageId
  ) {
    throw new Error('Conversation context belongs to a different request.');
  }
  if (
    (expected.projectId === undefined && manifest.scope.kind !== 'unscoped') ||
    (expected.projectId !== undefined &&
      (manifest.scope.kind !== 'project' ||
        manifest.scope.projectId !== expected.projectId))
  ) {
    throw new Error('Conversation context belongs to a different scope.');
  }
  if (
    manifest.entries.length !== messages.length ||
    manifest.totalMessages !== messages.length
  ) {
    throw new Error('Conversation context message counts are inconsistent.');
  }
  if (
    messages.length > manifest.limits.maxMessages ||
    messages.length % 2 !== 0 ||
    manifest.exclusions.limits % 2 !== 0
  ) {
    throw new Error('Conversation context violates its message limits.');
  }

  const messageIds = new Set<string>();
  let totalCharacters = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const entry = manifest.entries[index];
    if (message === undefined || entry === undefined) {
      throw new Error('Conversation context entries are incomplete.');
    }
    if (messageIds.has(message.messageId)) {
      throw new Error('Conversation context contains duplicate messages.');
    }
    messageIds.add(message.messageId);
    const sha256 = createHash('sha256').update(message.content).digest('hex');
    if (
      entry.messageId !== message.messageId ||
      entry.taskId !== message.taskId ||
      entry.role !== message.role ||
      entry.characters !== message.content.length ||
      entry.sha256 !== sha256
    ) {
      throw new Error(
        'Conversation context content does not match its manifest.',
      );
    }
    const expectedRole = index % 2 === 0 ? 'owner' : 'vera';
    if (message.role !== expectedRole) {
      throw new Error('Conversation context does not contain complete turns.');
    }
    if (
      expectedRole === 'vera' &&
      messages[index - 1]?.taskId !== message.taskId
    ) {
      throw new Error('Conversation context turn identities are inconsistent.');
    }
    totalCharacters += message.content.length;
  }
  if (
    totalCharacters !== manifest.totalCharacters ||
    totalCharacters > manifest.limits.maxCharacters
  ) {
    throw new Error('Conversation context character totals are inconsistent.');
  }

  const reconstructed = assembleConversationContext({
    conversation: expected.conversation,
    throughMessageId: expected.throughMessageId,
    ...(expected.projectId === undefined
      ? {}
      : { projectId: expected.projectId }),
    limits: manifest.limits,
  });
  if (!isDeepStrictEqual(context, reconstructed)) {
    throw new Error(
      'Conversation context does not match durable conversation history.',
    );
  }
}
