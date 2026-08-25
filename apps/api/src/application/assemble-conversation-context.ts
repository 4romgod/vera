import { createHash } from 'node:crypto';

import {
  ConversationContextBundleSchema,
  type ConversationContextBundle,
  type ConversationContextLimits,
} from '../domain/conversation-context.ts';
import type {
  Conversation,
  ConversationMessage,
} from '../domain/conversation.ts';

type CompleteTurn = {
  taskId: string;
  owner: ConversationMessage;
  vera: ConversationMessage;
  ownerIndex: number;
};

function sameScope(
  message: ConversationMessage,
  projectId: string | undefined,
): boolean {
  return message.projectId === projectId;
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function assembleConversationContext(input: {
  conversation: Conversation;
  throughMessageId: string;
  projectId?: string;
  limits: ConversationContextLimits;
}): ConversationContextBundle {
  const throughIndex = input.conversation.messages.findIndex(
    (message) => message.id === input.throughMessageId,
  );
  if (throughIndex < 0) {
    throw new Error(
      `Message ${input.throughMessageId} does not belong to conversation ${input.conversation.id}.`,
    );
  }

  const priorMessages = input.conversation.messages.slice(0, throughIndex);
  const scopedMessages = priorMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => sameScope(message, input.projectId));
  const byTask = new Map<
    string,
    {
      owner?: ConversationMessage;
      vera?: ConversationMessage;
      ownerIndex?: number;
    }
  >();

  for (const { message, index } of scopedMessages) {
    if (message.taskId === undefined) continue;
    const turn = byTask.get(message.taskId) ?? {};
    if (message.role === 'owner' && turn.owner === undefined) {
      turn.owner = message;
      turn.ownerIndex = index;
    }
    if (message.role === 'vera' && turn.vera === undefined) {
      turn.vera = message;
    }
    byTask.set(message.taskId, turn);
  }

  const completeTurns: CompleteTurn[] = [];
  for (const [taskId, turn] of byTask.entries()) {
    if (
      turn.owner !== undefined &&
      turn.vera !== undefined &&
      turn.ownerIndex !== undefined
    ) {
      completeTurns.push({
        taskId,
        owner: turn.owner,
        vera: turn.vera,
        ownerIndex: turn.ownerIndex,
      });
    }
  }
  completeTurns.sort((left, right) => left.ownerIndex - right.ownerIndex);

  const selectedTurns: CompleteTurn[] = [];
  let totalCharacters = 0;
  let excludedByLimits = 0;
  for (let index = completeTurns.length - 1; index >= 0; index -= 1) {
    const turn = completeTurns[index];
    if (turn === undefined) continue;
    const characters = turn.owner.content.length + turn.vera.content.length;
    if (
      selectedTurns.length * 2 + 2 > input.limits.maxMessages ||
      totalCharacters + characters > input.limits.maxCharacters
    ) {
      excludedByLimits += (index + 1) * 2;
      break;
    }
    selectedTurns.unshift(turn);
    totalCharacters += characters;
  }

  const selectedMessages = selectedTurns.flatMap((turn) => [
    { message: turn.owner, taskId: turn.taskId },
    { message: turn.vera, taskId: turn.taskId },
  ]);
  const completeMessageCount = completeTurns.length * 2;
  const messages = selectedMessages.map(({ message, taskId }) => ({
    messageId: message.id,
    taskId,
    role: message.role,
    content: message.content,
  }));

  return ConversationContextBundleSchema.parse({
    manifest: {
      schemaVersion: 1,
      conversationId: input.conversation.id,
      throughMessageId: input.throughMessageId,
      scope:
        input.projectId === undefined
          ? { kind: 'unscoped' }
          : { kind: 'project', projectId: input.projectId },
      entries: selectedMessages.map(({ message, taskId }) => ({
        messageId: message.id,
        taskId,
        role: message.role,
        sha256: hash(message.content),
        characters: message.content.length,
      })),
      totalMessages: messages.length,
      totalCharacters,
      limits: input.limits,
      exclusions: {
        differentScope: priorMessages.length - scopedMessages.length,
        incompleteTurns: scopedMessages.length - completeMessageCount,
        limits: excludedByLimits,
      },
    },
    messages,
  });
}
