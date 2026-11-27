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
import { RunBudgetSchema } from '../../../domain/tasks/run-budget.ts';

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
    prepareExternalSignalContext,
    assertMatchingTaskInput,
    finalizeConversationReply,
    evaluate,
    executeApproved,
    progress,
    continueAdaptiveGoalInline,
  } = operations;

  type ClarificationAnswerInput = Parameters<
    TaskLifecycle['answerClarification']
  >[0];

  // Every answer precondition is checked here, so a caller can validate an
  // answer before durably appending its conversation message and avoid an
  // owner message that no task will ever answer.
  async function admitClarificationAnswer(
    input: Omit<ClarificationAnswerInput, 'messageId'> & {
      messageId?: string;
    },
    mode: { requireMessage: boolean },
  ): Promise<
    | { kind: 'replay'; aggregate: TaskAggregate }
    | {
        kind: 'fresh';
        existing: TaskAggregate;
        projectId: string | undefined;
        combinedAttachments: NonNullable<TaskAggregate['task']['attachments']>;
      }
  > {
    const existing = await options.store.findByTaskId(
      input.principalId,
      input.taskId,
    );
    if (existing === null) {
      throw new LifecycleError(
        `Task ${input.taskId} was not found.`,
        'task_not_found',
      );
    }
    const projectId = input.projectId ?? existing.task.projectId;
    const priorAnswer = existing.run.clarification?.rounds
      .map((round) => round.answer)
      .find((answer) => answer?.requestKey === input.requestKey);
    if (priorAnswer !== undefined) {
      if (
        priorAnswer.content !== input.content ||
        priorAnswer.projectId !== projectId ||
        JSON.stringify(priorAnswer.attachments ?? []) !==
          JSON.stringify(input.attachments ?? [])
      ) {
        throw new LifecycleError(
          `Idempotency key ${input.requestKey} is already associated with a different clarification answer.`,
          'idempotency_key_reused',
        );
      }
      return { kind: 'replay', aggregate: existing };
    }
    if (
      existing.run.status !== 'awaiting_clarification' ||
      existing.run.clarification?.status !== 'awaiting_answer'
    ) {
      throw new LifecycleError(
        `Task ${input.taskId} is not awaiting clarification.`,
        'clarification_not_found',
      );
    }
    if (
      existing.task.conversationId !== undefined &&
      existing.run.conversationReply?.status !== 'projected'
    ) {
      throw new LifecycleError(
        'The clarification question is not ready for an answer.',
        'clarification_not_ready',
      );
    }
    if (
      mode.requireMessage &&
      existing.task.conversationId !== undefined &&
      input.messageId === undefined
    ) {
      throw new LifecycleError(
        'Conversation clarification answers must be durable conversation messages.',
        'conversation_message_mismatch',
      );
    }
    if (
      existing.task.projectId !== undefined &&
      projectId !== existing.task.projectId
    ) {
      throw new LifecycleError(
        'A task cannot change its established project scope during clarification.',
        'conversation_message_mismatch',
      );
    }
    const combinedAttachments = [
      ...(existing.task.attachments ?? []),
      ...(input.attachments ?? []),
    ].filter(
      (attachment, index, all) =>
        all.findIndex(({ id }) => id === attachment.id) === index,
    );
    if (combinedAttachments.length > 5) {
      throw new LifecycleError(
        'A task can use at most five attachments across its request and clarification answers.',
        'clarification_attachment_limit_exceeded',
      );
    }
    if (projectId !== undefined) {
      const project = await options.resources.findProjectById(
        input.principalId,
        projectId,
      );
      if (project === null) {
        throw new LifecycleError(
          `Project ${projectId} was not found.`,
          'project_not_found',
        );
      }
    }
    return { kind: 'fresh', existing, projectId, combinedAttachments };
  }

  return {
    async submit(input) {
      const assignedBudget = RunBudgetSchema.parse({
        limits: input.budgetLimits ?? budget.limits,
        consumed: { modelCalls: 0, capabilityInvocations: 0, retries: 0 },
      });
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
      const externalSignalContext = await prepareExternalSignalContext({
        principalId: input.principalId,
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        ...(input.externalSignalId === undefined
          ? {}
          : { externalSignalId: input.externalSignalId }),
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
          data: { limits: assignedBudget.limits },
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
      if (externalSignalContext !== undefined) {
        initialEvents.push({
          schemaVersion: 1,
          id: createId('event'),
          sequence: initialEvents.length + 1,
          type: 'external_signal_context_assembled',
          occurredAt: now,
          data: {
            signalId: externalSignalContext.manifest.signalId,
            signalVersion: externalSignalContext.manifest.signalVersion,
            projectId: externalSignalContext.manifest.projectId,
            characters: externalSignalContext.manifest.characters,
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
          ...(externalSignalContext === undefined
            ? {}
            : {
                externalSignal: {
                  id: externalSignalContext.manifest.signalId,
                  version: externalSignalContext.manifest.signalVersion,
                },
              }),
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
          budget: structuredClone(assignedBudget),
          ...(conversationContext === undefined ? {} : { conversationContext }),
          ...(memoryContext === undefined ? {} : { memoryContext }),
          ...(externalSignalContext === undefined
            ? {}
            : { externalSignalContext }),
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
        if (
          JSON.stringify(creation.aggregate.run.externalSignalContext) !==
          JSON.stringify(externalSignalContext)
        ) {
          throw new LifecycleError(
            `Idempotency key ${input.requestKey} is already associated with different external signal context.`,
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

    async findAwaitingClarification(input) {
      if (input.taskId !== undefined) {
        const selected = await options.store.findByTaskId(
          input.principalId,
          input.taskId,
        );
        const isIdempotentAnswerRetry =
          input.answerRequestKey !== undefined &&
          selected?.run.clarification?.rounds.some(
            (round) => round.answer?.requestKey === input.answerRequestKey,
          ) === true;
        if (selected?.task.conversationId !== input.conversationId) {
          throw new LifecycleError(
            `Task ${input.taskId} is not awaiting clarification in this conversation.`,
            'clarification_not_found',
          );
        }
        if (
          selected.run.status !== 'awaiting_clarification' &&
          !isIdempotentAnswerRetry
        ) {
          throw new LifecycleError(
            `Task ${input.taskId} is not awaiting clarification in this conversation.`,
            'clarification_not_found',
          );
        }
        return selected;
      }
      if (input.answerRequestKey !== undefined) {
        // A retried answer whose first attempt was recorded but not yet linked
        // to its conversation message must resolve to the same task, not start
        // a new one or fail because the task already left the waiting state.
        const answered = await options.store.findByClarificationAnswerKey(
          input.principalId,
          input.conversationId,
          input.answerRequestKey,
        );
        if (answered !== null) return answered;
      }
      const candidates =
        await options.store.listAwaitingClarificationsByConversation(
          input.principalId,
          input.conversationId,
          2,
        );
      if (candidates.length > 1) {
        throw new LifecycleError(
          'More than one task is awaiting clarification in this conversation; select the task being answered.',
          'clarification_ambiguous',
        );
      }
      return candidates[0] ?? null;
    },

    async assertClarificationAnswerable(input) {
      await admitClarificationAnswer(input, { requireMessage: false });
    },

    async answerClarification(input) {
      const admission = await admitClarificationAnswer(input, {
        requireMessage: true,
      });
      if (admission.kind === 'replay') {
        return finalizeConversationReply(admission.aggregate);
      }
      const { existing, projectId, combinedAttachments } = admission;
      const messageId = input.messageId ?? createId('message');
      const conversationContext =
        existing.task.conversationId === undefined
          ? undefined
          : await prepareConversationContext({
              principalId: input.principalId,
              message: input.content,
              conversationId: existing.task.conversationId,
              messageId,
              ...(projectId === undefined ? {} : { projectId }),
              ...(input.attachments === undefined
                ? {}
                : { attachments: input.attachments }),
            });
      const memoryContext = await prepareMemoryContext({
        principalId: input.principalId,
        ...(projectId === undefined ? {} : { projectId }),
        assembledAt: clock(),
      });
      const answeredAt = clock();
      const result = await update(
        input.principalId,
        input.taskId,
        (candidate) => {
          if (
            candidate.run.status !== 'awaiting_clarification' ||
            candidate.run.clarification?.status !== 'awaiting_answer'
          ) {
            return false;
          }
          const round = candidate.run.clarification.rounds.at(-1);
          if (round === undefined || round.answer !== undefined) return false;
          candidate.run.clarification.totalWaitingMs += Math.max(
            0,
            Date.parse(answeredAt) - Date.parse(round.askedAt),
          );
          round.answer = {
            messageId,
            requestKey: input.requestKey,
            content: input.content,
            ...(projectId === undefined ? {} : { projectId }),
            ...(input.attachments === undefined ||
            input.attachments.length === 0
              ? {}
              : { attachments: input.attachments }),
            answeredAt,
          };
          candidate.run.clarification.status = 'evaluating_answer';
          candidate.run.status = 'deciding';
          candidate.task.status = 'active';
          candidate.task.updatedAt = answeredAt;
          candidate.run.updatedAt = answeredAt;
          if (projectId !== undefined) candidate.task.projectId = projectId;
          if (combinedAttachments.length > 0) {
            candidate.task.attachments = combinedAttachments;
          }
          if (conversationContext === undefined) {
            delete candidate.run.conversationContext;
          } else {
            candidate.run.conversationContext = conversationContext;
          }
          if (memoryContext === undefined) delete candidate.run.memoryContext;
          else candidate.run.memoryContext = memoryContext;
          delete candidate.run.decision;
          delete candidate.run.conversationReply;
          appendEvent(
            candidate,
            'clarification_answered',
            answeredAt,
            { clarificationId: round.id, messageId },
            createId,
          );
          return true;
        },
      );
      if (result.aggregate.run.status !== 'deciding') {
        const recordedAnswer = result.aggregate.run.clarification?.rounds
          .map((round) => round.answer)
          .find((answer) => answer?.requestKey === input.requestKey);
        if (
          recordedAnswer?.content === input.content &&
          recordedAnswer.projectId === projectId &&
          JSON.stringify(recordedAnswer.attachments ?? []) ===
            JSON.stringify(input.attachments ?? [])
        ) {
          return finalizeConversationReply(result.aggregate);
        }
        throw new LifecycleError(
          'The clarification was already answered.',
          'clarification_already_answered',
        );
      }
      if (executionMode === 'worker') return result.aggregate;
      return finalizeConversationReply(await evaluate(result.aggregate));
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
          if (
            !wasExecuting &&
            aggregate.run.clarification?.status === 'awaiting_answer'
          ) {
            aggregate.run.clarification.status = 'cancelled';
            aggregate.run.clarification.cancelledAt = requestedAt;
            delete aggregate.run.conversationReply;
            appendEvent(
              aggregate,
              'clarification_cancelled',
              requestedAt,
              {},
              createId,
            );
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
