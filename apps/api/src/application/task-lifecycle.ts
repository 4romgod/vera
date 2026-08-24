import { randomUUID } from 'node:crypto';

import type { EvaluateModelDecision } from './evaluate-model-decision.ts';
import type { DecisionResult } from '../domain/execution-decision.ts';
import {
  TaskAggregateSchema,
  type TaskAggregate,
  type TaskEventType,
} from '../domain/task-aggregate.ts';
import { ModelProviderError } from '../model/model-provider.ts';
import type { DevelopmentPlanningCapability } from '../ports/development-planning-capability.ts';
import type { ExecutionStore } from '../ports/execution-store.ts';
import { projectAggregate, type Scratchpad } from '../ports/scratchpad.ts';

export type LifecycleErrorCode =
  | 'task_not_found'
  | 'run_not_found'
  | 'approval_not_found'
  | 'approval_already_decided'
  | 'idempotency_key_reused'
  | 'concurrent_transition_failed';

export class LifecycleError extends Error {
  public constructor(
    message: string,
    public readonly code: LifecycleErrorCode,
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

export type LifecycleObserver = {
  warning(error: unknown, context: Record<string, unknown>): void;
};

export type TaskLifecycle = {
  submit(input: {
    message: string;
    requestKey: string;
    principalId: string;
  }): Promise<TaskAggregate>;
  getTask(taskId: string): Promise<TaskAggregate>;
  getRun(runId: string): Promise<TaskAggregate>;
  decideApproval(input: {
    approvalId: string;
    decision: 'approved' | 'rejected';
    principalId: string;
  }): Promise<TaskAggregate>;
  recoverInterrupted(): Promise<void>;
};

type IdFactory = (prefix: string) => string;
type Clock = () => string;

const defaultObserver: LifecycleObserver = {
  warning: () => undefined,
};

function appendEvent(
  aggregate: TaskAggregate,
  type: TaskEventType,
  occurredAt: string,
  data: Record<string, unknown>,
  createId: IdFactory,
): void {
  aggregate.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: aggregate.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

export function createTaskLifecycle(options: {
  store: ExecutionStore;
  scratchpad: Scratchpad;
  evaluateModelDecision: EvaluateModelDecision;
  developmentPlanning: DevelopmentPlanningCapability;
  observer?: LifecycleObserver;
  clock?: Clock;
  createId?: IdFactory;
}): TaskLifecycle {
  const observer = options.observer ?? defaultObserver;
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  async function project(aggregate: TaskAggregate): Promise<void> {
    try {
      await options.scratchpad.put(projectAggregate(aggregate));
    } catch (error) {
      observer.warning(error, {
        operation: 'scratchpad_projection',
        taskId: aggregate.task.id,
        runId: aggregate.run.id,
        aggregateVersion: aggregate.version,
      });
    }
  }

  async function update(
    taskId: string,
    transition: (aggregate: TaskAggregate) => boolean,
  ): Promise<{ aggregate: TaskAggregate; changed: boolean }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await options.store.findByTaskId(taskId);
      if (current === null) {
        throw new LifecycleError(
          `Task ${taskId} was not found.`,
          'task_not_found',
        );
      }

      const next = structuredClone(current);
      if (!transition(next)) {
        return { aggregate: current, changed: false };
      }
      next.version = current.version + 1;
      const validated = TaskAggregateSchema.parse(next);
      if (await options.store.replace(validated, current.version)) {
        await project(validated);
        return { aggregate: validated, changed: true };
      }
    }

    throw new LifecycleError(
      `Task ${taskId} changed too frequently to apply the transition.`,
      'concurrent_transition_failed',
    );
  }

  async function recordDecision(
    taskId: string,
    decision: DecisionResult,
  ): Promise<TaskAggregate> {
    const approvalId = createId('approval');
    const now = clock();
    const result = await update(taskId, (aggregate) => {
      if (aggregate.run.status !== 'deciding') {
        return false;
      }

      aggregate.run.decision = decision;
      aggregate.run.updatedAt = now;
      aggregate.task.updatedAt = now;
      appendEvent(
        aggregate,
        'model_decision_recorded',
        now,
        { decisionId: decision.decisionId, kind: decision.decision.kind },
        createId,
      );

      if (decision.decision.kind === 'respond') {
        aggregate.run.status = 'succeeded';
        aggregate.task.status = 'completed';
        aggregate.run.output = {
          kind: 'response',
          message: decision.decision.message,
        };
        appendEvent(aggregate, 'run_succeeded', now, {}, createId);
        return true;
      }

      if (decision.decision.kind === 'rejected') {
        aggregate.run.status = 'rejected';
        aggregate.task.status = 'rejected';
        appendEvent(
          aggregate,
          'run_rejected',
          now,
          { code: decision.decision.code },
          createId,
        );
        return true;
      }

      aggregate.run.status = 'awaiting_approval';
      aggregate.run.approval = {
        id: approvalId,
        status: 'pending',
        reason: decision.decision.reason,
        capability: decision.decision.capability,
        proposedArguments: decision.decision.proposedArguments,
        requestedAt: now,
      };
      appendEvent(
        aggregate,
        'approval_requested',
        now,
        {
          approvalId,
          capability: `${decision.decision.capability.name}@${String(decision.decision.capability.version)}`,
        },
        createId,
      );
      return true;
    });
    return result.aggregate;
  }

  async function recordFailure(
    taskId: string,
    code:
      | 'model_provider_failure'
      | 'capability_execution_failure'
      | 'internal_failure',
    publicMessage: string,
    eventType: 'run_failed' | 'capability_invocation_failed',
  ): Promise<TaskAggregate> {
    const now = clock();
    const result = await update(taskId, (aggregate) => {
      if (
        aggregate.run.status === 'succeeded' ||
        aggregate.run.status === 'rejected' ||
        aggregate.run.status === 'failed'
      ) {
        return false;
      }
      aggregate.run.status = 'failed';
      aggregate.task.status = 'failed';
      aggregate.run.failure = { code, message: publicMessage };
      aggregate.run.updatedAt = now;
      aggregate.task.updatedAt = now;
      if (aggregate.run.invocation?.status === 'executing') {
        aggregate.run.invocation.status = 'failed';
        aggregate.run.invocation.completedAt = now;
      }
      appendEvent(aggregate, eventType, now, { code }, createId);
      if (eventType !== 'run_failed') {
        appendEvent(aggregate, 'run_failed', now, { code }, createId);
      }
      return true;
    });
    return result.aggregate;
  }

  async function evaluate(aggregate: TaskAggregate): Promise<TaskAggregate> {
    try {
      const decision = await options.evaluateModelDecision(
        aggregate.task.message,
      );
      return await recordDecision(aggregate.task.id, decision);
    } catch (error) {
      observer.warning(error, {
        operation: 'model_decision',
        taskId: aggregate.task.id,
        runId: aggregate.run.id,
      });
      return recordFailure(
        aggregate.task.id,
        error instanceof ModelProviderError
          ? 'model_provider_failure'
          : 'internal_failure',
        error instanceof ModelProviderError
          ? 'The model provider could not decide how to handle this task.'
          : 'Vera could not decide how to handle this task.',
        'run_failed',
      );
    }
  }

  async function executeApproved(
    aggregate: TaskAggregate,
    resumeExistingInvocation: boolean,
  ): Promise<TaskAggregate> {
    const invocationId = createId('invocation');
    const now = clock();
    const claim = await update(aggregate.task.id, (candidate) => {
      if (
        candidate.run.status !== 'awaiting_approval' ||
        candidate.run.approval?.status !== 'approved'
      ) {
        return false;
      }
      candidate.run.status = 'executing';
      candidate.run.updatedAt = now;
      candidate.task.updatedAt = now;
      candidate.run.invocation = {
        id: invocationId,
        status: 'executing',
        capability: candidate.run.approval.capability,
        arguments: candidate.run.approval.proposedArguments,
        startedAt: now,
      };
      appendEvent(
        candidate,
        'capability_invocation_started',
        now,
        { invocationId },
        createId,
      );
      return true;
    });

    const claimedInvocation = claim.aggregate.run.invocation;
    if (claimedInvocation === undefined) {
      return claim.aggregate;
    }
    // Only the caller that won the awaiting-approval transition executes fresh
    // work. Startup recovery is the one exception: it may resume the already
    // persisted invocation ID without writing a second start event.
    const freshlyClaimed =
      claim.changed && claimedInvocation.id === invocationId;
    const resumingInterruptedInvocation =
      !claim.changed &&
      resumeExistingInvocation &&
      claim.aggregate.run.status === 'executing' &&
      claimedInvocation.status === 'executing';
    const shouldExecute = freshlyClaimed || resumingInterruptedInvocation;
    if (!shouldExecute) {
      return claim.aggregate;
    }

    try {
      const result = await options.developmentPlanning.execute(
        claimedInvocation.arguments,
        claimedInvocation.id,
      );
      const completedAt = clock();
      const completion = await update(claim.aggregate.task.id, (candidate) => {
        if (
          candidate.run.status !== 'executing' ||
          candidate.run.invocation?.id !== claimedInvocation.id ||
          candidate.run.invocation.status !== 'executing'
        ) {
          return false;
        }
        candidate.run.status = 'succeeded';
        candidate.task.status = 'completed';
        candidate.run.updatedAt = completedAt;
        candidate.task.updatedAt = completedAt;
        candidate.run.invocation.status = 'succeeded';
        candidate.run.invocation.completedAt = completedAt;
        candidate.run.invocation.model = result.model;
        candidate.run.output = {
          kind: 'development_plan',
          plan: result.plan,
        };
        appendEvent(
          candidate,
          'capability_invocation_succeeded',
          completedAt,
          { invocationId: claimedInvocation.id },
          createId,
        );
        appendEvent(candidate, 'run_succeeded', completedAt, {}, createId);
        return true;
      });
      return completion.aggregate;
    } catch (error) {
      observer.warning(error, {
        operation: 'capability_execution',
        taskId: claim.aggregate.task.id,
        runId: claim.aggregate.run.id,
        invocationId: claimedInvocation.id,
      });
      return recordFailure(
        claim.aggregate.task.id,
        'capability_execution_failure',
        'The development planning capability could not complete the task.',
        'capability_invocation_failed',
      );
    }
  }

  return {
    async submit(input) {
      const now = clock();
      const taskId = createId('task');
      const runId = createId('run');
      const aggregate: TaskAggregate = {
        schemaVersion: 1,
        version: 1,
        task: {
          id: taskId,
          requestKey: input.requestKey,
          principalId: input.principalId,
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
        },
        events: [
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
        ],
      };
      const creation = await options.store.create(
        TaskAggregateSchema.parse(aggregate),
      );
      await project(creation.aggregate);
      if (
        !creation.created &&
        (creation.aggregate.task.message !== input.message ||
          creation.aggregate.task.principalId !== input.principalId)
      ) {
        throw new LifecycleError(
          `Idempotency key ${input.requestKey} is already associated with different task input.`,
          'idempotency_key_reused',
        );
      }
      if (!creation.created && creation.aggregate.run.status !== 'deciding') {
        return creation.aggregate;
      }
      return evaluate(creation.aggregate);
    },

    async getTask(taskId) {
      const aggregate = await options.store.findByTaskId(taskId);
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

    async getRun(runId) {
      const aggregate = await options.store.findByRunId(runId);
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
      const existing = await options.store.findByApprovalId(input.approvalId);
      if (existing === null) {
        throw new LifecycleError(
          `Approval ${input.approvalId} was not found.`,
          'approval_not_found',
        );
      }
      const currentStatus = existing.run.approval?.status;
      if (currentStatus !== 'pending') {
        if (currentStatus !== input.decision) {
          throw new LifecycleError(
            `Approval ${input.approvalId} has already been ${String(currentStatus)}.`,
            'approval_already_decided',
          );
        }
        return currentStatus === 'approved'
          ? executeApproved(existing, false)
          : existing;
      }

      const decidedAt = clock();
      const decision = await update(existing.task.id, (aggregate) => {
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
          appendEvent(
            aggregate,
            'run_rejected',
            decidedAt,
            { reason: 'approval_rejected' },
            createId,
          );
        }
        return true;
      });
      if (decision.aggregate.run.approval?.status !== input.decision) {
        throw new LifecycleError(
          `Approval ${input.approvalId} has already been ${String(decision.aggregate.run.approval?.status)}.`,
          'approval_already_decided',
        );
      }
      return input.decision === 'approved'
        ? executeApproved(decision.aggregate, false)
        : decision.aggregate;
    },

    async recoverInterrupted() {
      const aggregates = await options.store.findRecoverable();
      for (const aggregate of aggregates) {
        await project(aggregate);
        if (aggregate.run.status === 'deciding') {
          await evaluate(aggregate);
          continue;
        }
        await executeApproved(aggregate, aggregate.run.status === 'executing');
      }
    },
  };
}
