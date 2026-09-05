import { createHash } from 'node:crypto';

import type { ConversationService } from '../conversations/conversation-service.ts';
import type { TaskLifecycle } from '../tasks/task-lifecycle.ts';
import type { ExternalAwarenessOperations } from '../../ports/external-awareness/external-awareness-operations.ts';
import type { ExternalSignal } from '../../domain/external-awareness/external-signal.ts';

export type ExternalSignalTriageService = ReturnType<
  typeof createExternalSignalTriageService
>;

export class ExternalSignalTriageError extends Error {
  public constructor(
    message: string,
    public readonly code: 'external_signal_not_active',
  ) {
    super(message);
    this.name = 'ExternalSignalTriageError';
  }
}

function defaultObjective(signal: ExternalSignal): string {
  switch (signal.category) {
    case 'failed_check':
      return 'Plan and fix the attached failed-check signal for the selected project. Determine the cause from verified project evidence, make the smallest safe repair, verify it, and keep every state-changing step behind a separate approval.';
    case 'review_requested':
      return 'Review the attached external review request for the selected project. Explain what needs attention and propose the smallest appropriate next action without changing external state unless I separately approve it.';
    case 'mentioned':
      return 'Review the attached external mention for the selected project. Explain why it needs my attention and propose the smallest appropriate next action without changing external state unless I separately approve it.';
    case 'assigned':
      return 'Review the attached external assignment for the selected project. Explain what is required and propose the smallest appropriate next action without changing external state unless I separately approve it.';
  }
}

function titleFor(signal: ExternalSignal): string {
  const subject =
    signal.category === 'failed_check'
      ? 'failed GitHub checks'
      : signal.category === 'review_requested'
        ? 'GitHub review request'
        : signal.category === 'mentioned'
          ? 'GitHub mention'
          : 'GitHub assignment';
  return `Handle ${subject} in ${signal.repository.owner}/${signal.repository.name}`.slice(
    0,
    200,
  );
}

function scopedKey(input: {
  principalId: string;
  signalId: string;
  requestKey: string;
}): string {
  const digest = createHash('sha256')
    .update(
      [input.principalId, input.signalId, input.requestKey].join('\u0000'),
    )
    .digest('hex');
  return `external-signal-triage:${digest}`;
}

export function createExternalSignalTriageService(options: {
  awareness: Pick<ExternalAwarenessOperations, 'get'>;
  conversations: ConversationService;
  tasks: TaskLifecycle;
}) {
  return {
    async handle(input: {
      principalId: string;
      signalId: string;
      requestKey: string;
      objective?: string;
    }) {
      const signal = await options.awareness.get(
        input.principalId,
        input.signalId,
      );
      if (signal.status !== 'active') {
        throw new ExternalSignalTriageError(
          `External signal ${input.signalId} is no longer active.`,
          'external_signal_not_active',
        );
      }
      const requestedObjective = input.objective?.trim();
      const objective =
        requestedObjective === undefined || requestedObjective.length === 0
          ? defaultObjective(signal)
          : requestedObjective;
      const requestKey = scopedKey(input);
      const conversation = await options.conversations.createConversation({
        principalId: input.principalId,
        creationKey: requestKey,
        title: titleFor(signal),
      });
      const appended = await options.conversations.appendOwnerMessage({
        principalId: input.principalId,
        conversationId: conversation.id,
        requestKey,
        content: objective,
        projectId: signal.project.id,
      });
      const task =
        appended.taskId === undefined
          ? await options.tasks.submit({
              principalId: input.principalId,
              requestKey: appended.messageId,
              message: objective,
              conversationId: conversation.id,
              messageId: appended.messageId,
              projectId: signal.project.id,
              externalSignalId: signal.id,
            })
          : await options.tasks.getTask(input.principalId, appended.taskId);
      if (appended.taskId === undefined) {
        await options.conversations.attachTask({
          principalId: input.principalId,
          conversationId: conversation.id,
          messageId: appended.messageId,
          taskId: task.task.id,
        });
      }
      return task;
    },
  };
}
