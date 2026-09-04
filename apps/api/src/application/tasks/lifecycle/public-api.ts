import {
  TaskAggregateSchema,
  type TaskAggregate,
} from '../../../domain/tasks/task-aggregate.ts';
import {
  appendEvent,
  LifecycleError,
  type TaskLifecycle,
  type TaskLifecycleRuntime,
} from './contracts.ts';
import type { TaskLifecycleFoundation } from './foundation.ts';
import type { TaskLifecycleDecisionRecording } from './decision-recording.ts';
import type { TaskLifecycleAdaptiveGoalOperations } from './adaptive-goal.ts';
import type { TaskLifecycleEvaluationOperations } from './evaluation.ts';
import type { TaskLifecycleExecutionOperations } from './execution.ts';
import type { TaskLifecycleProgressOperations } from './progress.ts';

export function createTaskLifecycleApi(
  runtime: TaskLifecycleRuntime,
  operations: TaskLifecycleFoundation &
    TaskLifecycleDecisionRecording &
    TaskLifecycleAdaptiveGoalOperations &
    TaskLifecycleEvaluationOperations &
    TaskLifecycleExecutionOperations &
    TaskLifecycleProgressOperations,
): TaskLifecycle {
  const { options, clock, createId, budget, executionMode, activeInvocations } =
    runtime;
  const {
    setCurrentGoalStepStatus,
    project,
    update,
    prepareConversationContext,
    prepareMemoryContext,
    assertMatchingTaskInput,
    finalizeConversationReply,
    evaluate,
    executeApproved,
    progress,
    continueAdaptiveGoalInline,
  } = operations;
  return {
    async submit(input) {
      const existing = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        assertMatchingTaskInput(existing, input);
        await project(existing);
        return finalizeConversationReply(existing);
      }
      const now = clock();
      const taskId = createId('task');
      const runId = createId('run');
      const conversationContext = await prepareConversationContext(input);
      const memoryContext = await prepareMemoryContext({
        principalId: input.principalId,
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        assembledAt: now,
      });
      const initialEvents: TaskAggregate['events'] = [
        {
          schemaVersion: 1,
          id: createId('event'),
          sequence: 1,
          type: 'task_created',
          occurredAt: now,
          data: {},
        },
        {
          schemaVersion: 1,
          id: createId('event'),
          sequence: 2,
          type: 'run_started',
          occurredAt: now,
          data: { runId },
        },
        {
          schemaVersion: 1,
          id: createId('event'),
          sequence: 3,
          type: 'budget_assigned',
          occurredAt: now,
          data: { limits: budget.limits },
        },
      ];
      if (conversationContext !== undefined) {
        initialEvents.push({
          schemaVersion: 1,
          id: createId('event'),
          sequence: initialEvents.length + 1,
          type: 'conversation_context_assembled',
          occurredAt: now,
          data: {
            conversationId: conversationContext.manifest.conversationId,
            totalMessages: conversationContext.manifest.totalMessages,
            totalCharacters: conversationContext.manifest.totalCharacters,
            exclusions: conversationContext.manifest.exclusions,
          },
        });
      }
      if (memoryContext !== undefined) {
        initialEvents.push({
          schemaVersion: 1,
          id: createId('event'),
          sequence: initialEvents.length + 1,
          type: 'memory_context_assembled',
          occurredAt: now,
          data: {
            totalMemories: memoryContext.manifest.totalMemories,
            totalCharacters: memoryContext.manifest.totalCharacters,
            exclusions: memoryContext.manifest.exclusions,
          },
        });
      }
      const aggregate: TaskAggregate = {
        schemaVersion: 1,
        version: 1,
        task: {
          id: taskId,
          requestKey: input.requestKey,
          principalId: input.principalId,
          ...(input.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          ...(input.projectRevision === undefined
            ? {}
            : { projectRevision: input.projectRevision }),
          ...(input.conversationId === undefined
            ? {}
            : { conversationId: input.conversationId }),
          ...(input.messageId === undefined
            ? {}
            : { messageId: input.messageId }),
          ...(input.attachments === undefined || input.attachments.length === 0
            ? {}
            : { attachments: input.attachments }),
          message: input.message,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        run: {
          id: runId,
          status: 'deciding',
          createdAt: now,
          updatedAt: now,
          budget: structuredClone(budget),
          ...(conversationContext === undefined ? {} : { conversationContext }),
          ...(memoryContext === undefined ? {} : { memoryContext }),
        },
        events: initialEvents,
      };
      const creation = await options.store.create(
        TaskAggregateSchema.parse(aggregate),
      );
      await project(creation.aggregate);
      if (!creation.created) {
        assertMatchingTaskInput(creation.aggregate, input);
        if (
          JSON.stringify(creation.aggregate.run.conversationContext) !==
          JSON.stringify(conversationContext)
        ) {
          throw new LifecycleError(
            `Idempotency key ${input.requestKey} is already associated with different conversation context.`,
            'idempotency_key_reused',
          );
        }
        if (
          JSON.stringify(creation.aggregate.run.memoryContext) !==
          JSON.stringify(memoryContext)
        ) {
          throw new LifecycleError(
            `Idempotency key ${input.requestKey} is already associated with different memory context.`,
            'idempotency_key_reused',
          );
        }
      }
      if (!creation.created || executionMode === 'worker') {
        return creation.aggregate;
      }
      return finalizeConversationReply(await evaluate(creation.aggregate));
    },

    async getTask(principalId, taskId) {
      const aggregate = await options.store.findByTaskId(principalId, taskId);
      if (aggregate === null) {
        throw new LifecycleError(
          `Task ${taskId} was not found.`,
          'task_not_found',
        );
      }
      // Polling reads intentionally perform one idempotent, newer-version-only
      // Redis projection. Current projections are not mutated; missing or stale
      // scratchpads self-heal from MongoDB authority.
      await project(aggregate);
      return aggregate;
    },

    async getRun(principalId, runId) {
      const aggregate = await options.store.findByRunId(principalId, runId);
      if (aggregate === null) {
        throw new LifecycleError(
          `Run ${runId} was not found.`,
          'run_not_found',
        );
      }
      // See getTask: read repair is deliberate so losing Redis never requires a
      // separate reconciliation operation before a client can continue.
      await project(aggregate);
      return aggregate;
    },

    async decideApproval(input) {
      const existing = await options.store.findByApprovalId(
        input.principalId,
        input.approvalId,
      );
      if (existing === null) {
        throw new LifecycleError(
          `Approval ${input.approvalId} was not found.`,
          'approval_not_found',
        );
      }
      const currentStatus = existing.run.approval?.status;
      const historicalApproval = existing.run.approvalHistory?.find(
        (approval) => approval.id === input.approvalId,
      );
      if (historicalApproval !== undefined) {
        if (historicalApproval.status !== input.decision) {
          throw new LifecycleError(
            `Approval ${input.approvalId} has already been ${historicalApproval.status}.`,
            'approval_already_decided',
          );
        }
        return finalizeConversationReply(existing);
      }
      if (currentStatus !== 'pending') {
        if (currentStatus !== input.decision) {
          throw new LifecycleError(
            `Approval ${input.approvalId} has already been ${String(currentStatus)}.`,
            'approval_already_decided',
          );
        }
        const progressed =
          currentStatus === 'approved' && executionMode === 'inline'
            ? await continueAdaptiveGoalInline(
                await executeApproved(existing, false),
              )
            : existing;
        return finalizeConversationReply(progressed);
      }

      const decidedAt = clock();
      const decision = await update(
        input.principalId,
        existing.task.id,
        (aggregate) => {
          if (aggregate.run.approval?.status !== 'pending') {
            return false;
          }
          aggregate.run.approval.status = input.decision;
          aggregate.run.approval.decidedAt = decidedAt;
          aggregate.run.approval.decidedBy = input.principalId;
          aggregate.run.updatedAt = decidedAt;
          aggregate.task.updatedAt = decidedAt;
          appendEvent(
            aggregate,
            input.decision === 'approved'
              ? 'approval_approved'
              : 'approval_rejected',
            decidedAt,
            { approvalId: input.approvalId, principalId: input.principalId },
            createId,
          );
          if (input.decision === 'rejected') {
            aggregate.run.status = 'rejected';
            aggregate.task.status = 'rejected';
            if (aggregate.run.goal !== undefined) {
              aggregate.run.goal.status = 'rejected';
              setCurrentGoalStepStatus(aggregate, 'rejected');
            }
            appendEvent(
              aggregate,
              'run_rejected',
              decidedAt,
              { reason: 'approval_rejected' },
              createId,
            );
          }
          return true;
        },
      );
      if (decision.aggregate.run.approval?.status !== input.decision) {
        throw new LifecycleError(
          `Approval ${input.approvalId} has already been ${String(decision.aggregate.run.approval?.status)}.`,
          'approval_already_decided',
        );
      }
      const progressed =
        input.decision === 'approved' && executionMode === 'inline'
          ? await continueAdaptiveGoalInline(
              await executeApproved(decision.aggregate, false),
            )
          : decision.aggregate;
      return finalizeConversationReply(progressed);
    },

    async cancelRun(input) {
      const existing = await options.store.findByRunId(
        input.principalId,
        input.runId,
      );
      if (existing === null) {
        throw new LifecycleError(
          `Run ${input.runId} was not found.`,
          'run_not_found',
        );
      }
      if (
        ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
          existing.run.status,
        )
      ) {
        return finalizeConversationReply(existing);
      }
      const requestedAt = clock();
      const cancellation = await update(
        input.principalId,
        existing.task.id,
        (aggregate) => {
          if (
            ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
              aggregate.run.status,
            )
          ) {
            return false;
          }
          const wasExecuting = aggregate.run.status === 'executing';
          aggregate.run.status = wasExecuting
            ? 'cancellation_requested'
            : 'cancelled';
          aggregate.task.status = wasExecuting ? 'active' : 'cancelled';
          if (!wasExecuting && aggregate.run.goal !== undefined) {
            aggregate.run.goal.status = 'cancelled';
            setCurrentGoalStepStatus(aggregate, 'cancelled');
          }
          aggregate.run.updatedAt = requestedAt;
          aggregate.task.updatedAt = requestedAt;
          if (aggregate.run.approval?.status === 'pending') {
            aggregate.run.approval.status = 'rejected';
            aggregate.run.approval.decidedAt = requestedAt;
            aggregate.run.approval.decidedBy = input.principalId;
            appendEvent(
              aggregate,
              'approval_rejected',
              requestedAt,
              {
                approvalId: aggregate.run.approval.id,
                reason: 'run_cancelled',
              },
              createId,
            );
          }
          appendEvent(
            aggregate,
            'cancellation_requested',
            requestedAt,
            { principalId: input.principalId },
            createId,
          );
          if (!wasExecuting) {
            aggregate.run.failure = {
              code: 'cancelled',
              message: 'The run was cancelled before capability execution.',
            };
            appendEvent(aggregate, 'run_cancelled', requestedAt, {}, createId);
          }
          return true;
        },
      );
      const invocationId = cancellation.aggregate.run.invocation?.id;
      if (invocationId !== undefined) {
        activeInvocations.get(invocationId)?.abort();
      }
      return finalizeConversationReply(cancellation.aggregate);
    },

    async progressTask(principalId, taskId) {
      const aggregate = await options.store.findByTaskId(principalId, taskId);
      if (aggregate === null) {
        throw new LifecycleError(
          `Task ${taskId} was not found.`,
          'task_not_found',
        );
      }
      return progress(aggregate);
    },

    async recoverInterrupted() {
      const aggregates = await options.store.findRecoverable();
      for (const aggregate of aggregates) {
        await progress(aggregate);
      }
    },
  };
}
