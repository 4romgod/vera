import type { TaskResource } from '@vera/client';

const TERMINAL_RUN_STATUSES = new Set([
  'succeeded',
  'rejected',
  'failed',
  'cancelled',
]);

type SettlementView = Pick<
  TaskResource,
  'runStatus' | 'conversationId' | 'conversationReply'
>;

/**
 * Whether the assistant can stop following a run and show its outcome.
 *
 * A conversation reply, including a clarification question, counts only once
 * the API reports it projected into the conversation. Stopping earlier shows
 * no question, and an owner answer would be rejected as not ready.
 */
export function isRunSettledForConversation(task: SettlementView): boolean {
  if (task.runStatus === 'awaiting_approval') return true;
  const replyVisible =
    task.conversationId === undefined ||
    task.conversationReply?.status === 'projected';
  return (
    (task.runStatus === 'awaiting_clarification' ||
      TERMINAL_RUN_STATUSES.has(task.runStatus)) &&
    replyVisible
  );
}
