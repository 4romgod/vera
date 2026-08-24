import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../src/adapters/in-memory-execution-store.ts';
import { InMemoryScratchpad } from '../src/adapters/in-memory-scratchpad.ts';
import { createTaskLifecycle } from '../src/application/task-lifecycle.ts';
import type { DecisionResult } from '../src/domain/execution-decision.ts';
import type { DevelopmentPlan } from '../src/domain/development-plan.ts';
import { ModelProviderError } from '../src/model/model-provider.ts';
import type {
  DevelopmentPlanningArguments,
  DevelopmentPlanningCapability,
} from '../src/ports/development-planning-capability.ts';

const plan: DevelopmentPlan = {
  schemaVersion: 1,
  project: { name: 'Vera' },
  ticket: { reference: 'VERA-202', details: 'Trace every API request.' },
  objective: 'Add request tracing.',
  title: 'Add request tracing',
  summary: 'Introduce correlated request identifiers across the API.',
  scope: ['Propagate a request identifier through the API.'],
  nonGoals: ['Do not add distributed tracing infrastructure.'],
  assumptions: ['The API remains a single deployable service.'],
  unresolvedQuestions: [],
  affectedProjectAreas: [
    { area: 'HTTP boundary', rationale: 'Requests enter the system here.' },
  ],
  phases: [
    {
      name: 'Tracing boundary',
      objective: 'Create and propagate request identifiers.',
      steps: ['Add request ID middleware.', 'Attach IDs to domain events.'],
      verification: ['Assert one ID is present across a complete request.'],
    },
  ],
  risks: ['Sensitive data must not be added to trace attributes.'],
};

function responseDecision(message = 'Hello.'): DecisionResult {
  return {
    decisionId: 'decision_test',
    proposal: {
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'A direct response is sufficient.',
      message,
    },
    decision: { kind: 'respond', message },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function planningDecision(): DecisionResult {
  const proposedArguments = {
    objective: 'Add request tracing.',
    ticket: { reference: 'VERA-202', details: 'Trace every API request.' },
    project: { name: 'Vera' },
  };
  return {
    decisionId: 'decision_test',
    proposal: {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Specialist planning is appropriate.',
      capability: { name: 'development_planning', version: 1 },
      arguments: proposedArguments,
    },
    decision: {
      kind: 'approval_required',
      reason: 'external_capability_invocation',
      capability: { name: 'development_planning', version: 1 },
      proposedArguments,
    },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

class FakePlanningCapability implements DevelopmentPlanningCapability {
  public readonly calls: {
    arguments: DevelopmentPlanningArguments;
    invocationId: string;
  }[] = [];

  public constructor(
    private readonly implementation: () => Promise<{
      plan: DevelopmentPlan;
      model: { provider: string; model: string; durationMs: number };
    }> = () =>
      Promise.resolve({
        plan,
        model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
      }),
  ) {}

  public execute(
    arguments_: DevelopmentPlanningArguments,
    invocationId: string,
  ): Promise<{
    plan: DevelopmentPlan;
    model: { provider: string; model: string; durationMs: number };
  }> {
    this.calls.push({ arguments: arguments_, invocationId });
    return this.implementation();
  }
}

function harness(options?: {
  decision?: DecisionResult;
  evaluate?: () => Promise<DecisionResult>;
  capability?: FakePlanningCapability;
}) {
  const store = new InMemoryExecutionStore();
  const scratchpad = new InMemoryScratchpad();
  const capability = options?.capability ?? new FakePlanningCapability();
  let sequence = 0;
  let evaluations = 0;
  const lifecycle = createTaskLifecycle({
    store,
    scratchpad,
    evaluateModelDecision: async () => {
      evaluations += 1;
      return options?.evaluate === undefined
        ? (options?.decision ?? responseDecision())
        : options.evaluate();
    },
    developmentPlanning: capability,
    clock: () => '2026-08-24T18:00:00.000Z',
    createId: (prefix) => `${prefix}_${String(++sequence)}`,
  });
  return {
    lifecycle,
    store,
    scratchpad,
    capability,
    evaluations: () => evaluations,
  };
}

void describe('task lifecycle', () => {
  void it('durably completes direct responses and projects the run', async () => {
    const test = harness({ decision: responseDecision('Vera says hello.') });
    const aggregate = await test.lifecycle.submit({
      message: 'hello',
      requestKey: 'request-direct-1',
      principalId: 'owner_v1',
    });

    assert.equal(aggregate.task.status, 'completed');
    assert.equal(aggregate.run.status, 'succeeded');
    assert.deepEqual(aggregate.run.output, {
      kind: 'response',
      message: 'Vera says hello.',
    });
    assert.deepEqual(
      aggregate.events.map((event) => event.type),
      [
        'task_created',
        'run_started',
        'model_decision_recorded',
        'run_succeeded',
      ],
    );
    assert.equal(
      (await test.scratchpad.get(aggregate.run.id))?.aggregateVersion,
      aggregate.version,
    );
  });

  void it('requires approval and executes the exact proposed capability arguments', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-plan-1',
      principalId: 'owner_v1',
    });

    assert.equal(pending.run.status, 'awaiting_approval');
    assert.equal(pending.run.approval?.status, 'pending');
    assert.equal(test.capability.calls.length, 0);
    const approval = pending.run.approval;
    assert.ok(approval);

    const completed = await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });

    assert.equal(completed.run.status, 'succeeded');
    const invocation = completed.run.invocation;
    assert.ok(invocation);
    assert.equal(invocation.status, 'succeeded');
    const invocationModel = invocation.model;
    assert.ok(invocationModel);
    assert.equal(invocationModel.provider, 'fake');
    assert.deepEqual(completed.run.output, {
      kind: 'development_plan',
      plan,
    });
    assert.equal(test.capability.calls.length, 1);
    assert.deepEqual(
      test.capability.calls[0]?.arguments,
      approval.proposedArguments,
    );
  });

  void it('records rejection without invoking the capability', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-plan-2',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    const rejected = await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'rejected',
      principalId: 'owner_v1',
    });

    assert.equal(rejected.task.status, 'rejected');
    assert.equal(rejected.run.status, 'rejected');
    assert.equal(test.capability.calls.length, 0);
  });

  void it('deduplicates an identical repeated task submission', async () => {
    const test = harness({ decision: planningDecision() });
    const first = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'same-request-key',
      principalId: 'owner_v1',
    });
    const repeated = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'same-request-key',
      principalId: 'owner_v1',
    });

    assert.equal(repeated.task.id, first.task.id);
    assert.equal(repeated.run.id, first.run.id);
    assert.equal(test.evaluations(), 1);
  });

  void it('rejects reuse of an idempotency key for different input', async () => {
    const test = harness({ decision: planningDecision() });
    await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'conflicting-request-key',
      principalId: 'owner_v1',
    });

    await assert.rejects(
      test.lifecycle.submit({
        message: 'plan a different task',
        requestKey: 'conflicting-request-key',
        principalId: 'owner_v1',
      }),
      { code: 'idempotency_key_reused' },
    );
  });

  void it('makes repeated identical approval decisions idempotent', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-plan-3',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    const input = {
      approvalId: approval.id,
      decision: 'approved' as const,
      principalId: 'owner_v1',
    };
    const first = await test.lifecycle.decideApproval(input);
    const repeated = await test.lifecycle.decideApproval(input);

    assert.equal(first.run.status, 'succeeded');
    assert.equal(repeated.run.status, 'succeeded');
    assert.equal(test.capability.calls.length, 1);
  });

  void it('allows only one capability execution across concurrent approvals', async () => {
    const execution = Promise.withResolvers<undefined>();
    const capability = new FakePlanningCapability(async () => {
      await execution.promise;
      return {
        plan,
        model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
      };
    });
    const test = harness({ decision: planningDecision(), capability });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-concurrent-approval',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    const input = {
      approvalId: approval.id,
      decision: 'approved' as const,
      principalId: 'owner_v1',
    };

    const first = test.lifecycle.decideApproval(input);
    while (capability.calls.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const concurrent = await test.lifecycle.decideApproval(input);
    assert.equal(concurrent.run.status, 'executing');
    execution.resolve(undefined);
    const completed = await first;

    assert.equal(completed.run.status, 'succeeded');
    assert.equal(capability.calls.length, 1);
  });

  void it('rejects an approval decision that conflicts with its recorded decision', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-conflicting-approval',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'rejected',
      principalId: 'owner_v1',
    });

    await assert.rejects(
      test.lifecycle.decideApproval({
        approvalId: approval.id,
        decision: 'approved',
        principalId: 'owner_v1',
      }),
      { code: 'approval_already_decided' },
    );
  });

  void it('rebuilds a deleted scratchpad projection from durable state', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-plan-4',
      principalId: 'owner_v1',
    });
    await test.scratchpad.delete(pending.run.id);
    assert.equal(await test.scratchpad.get(pending.run.id), null);

    await test.lifecycle.getRun(pending.run.id);

    assert.equal(
      (await test.scratchpad.get(pending.run.id))?.runId,
      pending.run.id,
    );
  });

  void it('persists provider failure as a terminal run instead of losing the task', async () => {
    const test = harness({
      evaluate: () =>
        Promise.reject(
          new ModelProviderError(
            'Ollama is unavailable',
            'provider_unavailable',
          ),
        ),
    });
    const failed = await test.lifecycle.submit({
      message: 'hello',
      requestKey: 'request-failure-1',
      principalId: 'owner_v1',
    });

    assert.equal(failed.task.status, 'failed');
    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.failure?.code, 'model_provider_failure');
  });
});
