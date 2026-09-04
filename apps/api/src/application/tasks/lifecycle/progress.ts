import { type TaskAggregate } from '../../../domain/tasks/task-aggregate.ts';
import { appendEvent, type TaskLifecycleRuntime } from './contracts.ts';
import type { TaskLifecycleFoundation } from './foundation.ts';
import type { TaskLifecycleEvaluationOperations } from './evaluation.ts';
import type { TaskLifecycleExecutionOperations } from './execution.ts';

export function createProgressOperations(
  runtime: TaskLifecycleRuntime,
  operations: TaskLifecycleFoundation &
    TaskLifecycleEvaluationOperations &
    TaskLifecycleExecutionOperations,
) {
  const { clock, createId } = runtime;
  const {
    setCurrentGoalStepStatus,
    requiresConversationReplyProjection,
    addConversationReplyProjection,
    project,
    update,
    projectConversationReply,
    finalizeConversationReply,
    evaluate,
    executeApproved,
  } = operations;
  async function finalizeInterruptedCancellation(
    aggregate: TaskAggregate,
  ): Promise<TaskAggregate> {
    const cancelledAt = clock();
    const cancellation = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        if (candidate.run.status !== 'cancellation_requested') {
          return false;
        }
        candidate.run.status = 'cancelled';
        candidate.task.status = 'cancelled';
        candidate.run.updatedAt = cancelledAt;
        candidate.task.updatedAt = cancelledAt;
        if (candidate.run.invocation?.status === 'executing') {
          candidate.run.invocation.status = 'failed';
          candidate.run.invocation.completedAt = cancelledAt;
        }
        candidate.run.failure = {
          code: 'cancelled',
          message: 'The interrupted run was cancelled during recovery.',
        };
        if (candidate.run.goal !== undefined) {
          candidate.run.goal.status = 'cancelled';
          setCurrentGoalStepStatus(candidate, 'cancelled');
        }
        appendEvent(
          candidate,
          'run_cancelled',
          cancelledAt,
          { reason: 'recovered_cancellation_request' },
          createId,
        );
        return true;
      },
    );
    return cancellation.aggregate;
  }

  async function progress(aggregate: TaskAggregate): Promise<TaskAggregate> {
    await project(aggregate);
    if (requiresConversationReplyProjection(aggregate)) {
      const recoveredAt = clock();
      const recovered = await update(
        aggregate.task.principalId,
        aggregate.task.id,
        (candidate) => {
          if (!requiresConversationReplyProjection(candidate)) return false;
          addConversationReplyProjection(candidate, recoveredAt);
          return true;
        },
      );
      return finalizeConversationReply(recovered.aggregate);
    }
    if (aggregate.run.conversationReply?.status === 'pending') {
      return projectConversationReply(aggregate);
    }
    if (aggregate.run.status === 'deciding') {
      return finalizeConversationReply(await evaluate(aggregate));
    }
    if (aggregate.run.status === 'cancellation_requested') {
      return finalizeConversationReply(
        await finalizeInterruptedCancellation(aggregate),
      );
    }
    if (
      aggregate.run.status === 'awaiting_approval' &&
      aggregate.run.approval?.status === 'approved'
    ) {
      return finalizeConversationReply(await executeApproved(aggregate, false));
    }
    if (aggregate.run.status === 'executing') {
      return finalizeConversationReply(await executeApproved(aggregate, true));
    }
    return aggregate;
  }

  async function continueAdaptiveGoalInline(
    aggregate: TaskAggregate,
  ): Promise<TaskAggregate> {
    if (
      aggregate.run.status !== 'deciding' ||
      aggregate.run.goal?.schemaVersion !== 2
    ) {
      return aggregate;
    }
    return progress(aggregate);
  }

  return {
    finalizeInterruptedCancellation,
    progress,
    continueAdaptiveGoalInline,
  };
}

export type TaskLifecycleProgressOperations = ReturnType<
  typeof createProgressOperations
>;
