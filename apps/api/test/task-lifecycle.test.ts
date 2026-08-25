import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../src/adapters/in-memory-execution-store.ts';
import { InMemoryResourceStore } from '../src/adapters/in-memory-resource-store.ts';
import { InMemoryScratchpad } from '../src/adapters/in-memory-scratchpad.ts';
import { createTaskLifecycle } from '../src/application/task-lifecycle.ts';
import type { DecisionResult } from '../src/domain/execution-decision.ts';
import type { DevelopmentPlan } from '../src/domain/development-plan.ts';
import type { RunBudget } from '../src/domain/run-budget.ts';
import { sameCapabilityDestination } from '../src/domain/capability-destination.ts';
import { ModelProviderError } from '../src/model/model-provider.ts';
import type {
  DevelopmentPlanningCapability,
  DevelopmentPlanningCapabilityRegistry,
  DevelopmentPlanningInvocation,
} from '../src/ports/development-planning-capability.ts';
import type { ProjectContextAssembler } from '../src/ports/project-context-assembler.ts';

const plan: DevelopmentPlan = {
  schemaVersion: 1,
  project: {
    name: 'Vera',
    id: 'project_test',
    revision: 'test-revision',
  },
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
      reason: 'specialist_capability_invocation',
      capability: { name: 'development_planning', version: 1 },
      proposedArguments,
    },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

class FakePlanningCapability implements DevelopmentPlanningCapability {
  public readonly calls: {
    invocation: DevelopmentPlanningInvocation;
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
    public readonly destination: DevelopmentPlanningCapability['destination'] = {
      schemaVersion: 1,
      adapterId: 'test_planner',
      provider: 'fake',
      transport: 'in_process',
      dataBoundary: 'owner_controlled',
    },
  ) {}

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public execute(invocation: DevelopmentPlanningInvocation): Promise<{
    plan: DevelopmentPlan;
    model: { provider: string; model: string; durationMs: number };
  }> {
    this.calls.push({ invocation });
    return this.implementation();
  }
}

function registryFor(
  selected: DevelopmentPlanningCapability,
  capabilities: DevelopmentPlanningCapability[] = [selected],
): DevelopmentPlanningCapabilityRegistry {
  return {
    selected: () => selected,
    resolve: (destination) =>
      capabilities.find((capability) =>
        sameCapabilityDestination(capability.destination, destination),
      ) ?? null,
  };
}

function harness(options?: {
  decision?: DecisionResult;
  evaluate?: () => Promise<DecisionResult>;
  capability?: FakePlanningCapability;
  registry?: DevelopmentPlanningCapabilityRegistry;
  budget?: RunBudget;
  clock?: () => string;
  contextAssembler?: ProjectContextAssembler;
  executionMode?: 'inline' | 'worker';
}) {
  const store = new InMemoryExecutionStore();
  const resources = new InMemoryResourceStore();
  void resources.createProject({
    schemaVersion: 1,
    id: 'project_test',
    principalId: 'owner_v1',
    registrationKey: 'project-test',
    displayName: 'Vera',
    normalizedName: 'vera',
    source: { kind: 'local_git', rootPath: '/test/vera' },
    status: 'active',
    createdAt: '2026-08-24T18:00:00.000Z',
    updatedAt: '2026-08-24T18:00:00.000Z',
  });
  const scratchpad = new InMemoryScratchpad();
  const capability = options?.capability ?? new FakePlanningCapability();
  let sequence = 0;
  let evaluations = 0;
  const contextAssembler: ProjectContextAssembler =
    options?.contextAssembler ?? {
      assemble: (input) =>
        Promise.resolve({
          manifest: {
            schemaVersion: 1,
            projectId: input.project.id,
            sourceKind: 'local_git',
            revision: 'test-revision',
            generatedAt: '2026-08-24T18:00:00.000Z',
            entries: [],
            totalFiles: 0,
            totalBytes: 0,
            limits: input.limits,
            exclusions: ['Synthetic test context.'],
          },
          documents: [],
        }),
    };
  const actualLifecycle = createTaskLifecycle({
    store,
    scratchpad,
    evaluateModelDecision: async () => {
      evaluations += 1;
      return options?.evaluate === undefined
        ? (options?.decision ?? responseDecision())
        : options.evaluate();
    },
    developmentPlanning: options?.registry ?? registryFor(capability),
    resources,
    contextAssembler,
    ...(options?.executionMode === undefined
      ? {}
      : { executionMode: options.executionMode }),
    ...(options?.budget === undefined ? {} : { budget: options.budget }),
    clock: options?.clock ?? (() => '2026-08-24T18:00:00.000Z'),
    createId: (prefix) => `${prefix}_${String(++sequence)}`,
  });
  const lifecycle = {
    ...actualLifecycle,
    submit: (input: Parameters<typeof actualLifecycle.submit>[0]) =>
      actualLifecycle.submit({ projectId: 'project_test', ...input }),
  };
  return {
    lifecycle,
    store,
    resources,
    scratchpad,
    capability,
    evaluations: () => evaluations,
  };
}

void describe('task lifecycle', () => {
  void it('persists commands immediately and progresses them only when a worker runs', async () => {
    const test = harness({
      decision: planningDecision(),
      executionMode: 'worker',
    });
    const submitted = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-worker-progress',
      principalId: 'owner_v1',
    });

    assert.equal(submitted.run.status, 'deciding');
    assert.equal(test.evaluations(), 0);

    const pending = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(pending.run.status, 'awaiting_approval');
    assert.equal(test.evaluations(), 1);
    const approval = pending.run.approval;
    assert.ok(approval);

    const approved = await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    assert.equal(approved.run.status, 'awaiting_approval');
    assert.equal(approved.run.approval?.status, 'approved');
    assert.equal(test.capability.calls.length, 0);

    const completed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(completed.run.status, 'succeeded');
    assert.equal(test.capability.calls.length, 1);
  });

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
        'budget_assigned',
        'budget_consumed',
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
    assert.equal(completed.run.output?.kind, 'development_plan');
    assert.deepEqual(completed.run.output.plan, plan);
    assert.match(completed.run.output.artifact?.id ?? '', /^artifact_/u);
    assert.equal(test.capability.calls.length, 1);
    assert.deepEqual(
      test.capability.calls[0]?.invocation.arguments,
      approval.proposedArguments,
    );
  });

  void it('records the configured specialist destination in the approval', async () => {
    const capability = new FakePlanningCapability(undefined, {
      schemaVersion: 1,
      adapterId: 'claude_code_cli',
      provider: 'anthropic',
      transport: 'local_process',
      dataBoundary: 'third_party',
    });
    const test = harness({ decision: planningDecision(), capability });

    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-model-destination',
      principalId: 'owner_v1',
    });

    assert.deepEqual(pending.run.approval?.destination, {
      schemaVersion: 1,
      adapterId: 'claude_code_cli',
      provider: 'anthropic',
      transport: 'local_process',
      dataBoundary: 'third_party',
    });
  });

  void it('executes the approved adapter even when the selected adapter changes', async () => {
    const approvedCapability = new FakePlanningCapability();
    const newlySelectedCapability = new FakePlanningCapability(undefined, {
      schemaVersion: 1,
      adapterId: 'claude_code_cli',
      provider: 'anthropic',
      transport: 'local_process',
      dataBoundary: 'third_party',
    });
    let selected: DevelopmentPlanningCapability = approvedCapability;
    const capabilities = [approvedCapability, newlySelectedCapability];
    const registry: DevelopmentPlanningCapabilityRegistry = {
      selected: () => selected,
      resolve: (destination) =>
        capabilities.find((capability) =>
          sameCapabilityDestination(capability.destination, destination),
        ) ?? null,
    };
    const test = harness({
      decision: planningDecision(),
      capability: approvedCapability,
      registry,
    });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-adapter-configuration-drift',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    selected = newlySelectedCapability;

    const completed = await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });

    assert.equal(completed.run.status, 'succeeded');
    assert.equal(approvedCapability.calls.length, 1);
    assert.equal(newlySelectedCapability.calls.length, 0);
    assert.deepEqual(
      completed.run.invocation?.destination,
      approvedCapability.destination,
    );
    assert.deepEqual(
      completed.run.output?.kind === 'development_plan'
        ? completed.run.output.plan.project
        : undefined,
      plan.project,
    );
    const artifact = await test.resources.findArtifactByInvocationId(
      'owner_v1',
      completed.run.invocation.id,
    );
    assert.deepEqual(
      artifact?.producer.destination,
      approvedCapability.destination,
    );
  });

  void it('fails closed when the approved adapter can no longer be resolved', async () => {
    const approvedCapability = new FakePlanningCapability();
    let available = true;
    const registry: DevelopmentPlanningCapabilityRegistry = {
      selected: () => approvedCapability,
      resolve: (destination) =>
        available &&
        sameCapabilityDestination(approvedCapability.destination, destination)
          ? approvedCapability
          : null,
    };
    const test = harness({
      decision: planningDecision(),
      capability: approvedCapability,
      registry,
    });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-approved-adapter-unavailable',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    available = false;

    const failed = await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });

    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.approval?.status, 'approved');
    assert.equal(failed.run.invocation?.status, 'failed');
    assert.equal(failed.run.failure?.code, 'capability_execution_failure');
    assert.equal(approvedCapability.calls.length, 0);
  });

  void it('passes only the remaining wall-clock budget to the specialist', async () => {
    let now = '2026-08-24T18:00:00.000Z';
    const test = harness({
      decision: planningDecision(),
      clock: () => now,
      budget: {
        limits: {
          modelCalls: 1,
          capabilityInvocations: 1,
          retries: 0,
          maxDurationMs: 1_000,
          maxContextFiles: 10,
          maxContextBytes: 10_000,
          maxContextFileBytes: 1_000,
          maxArtifactBytes: 100_000,
        },
        consumed: { modelCalls: 0, capabilityInvocations: 0, retries: 0 },
      },
    });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-remaining-duration',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    now = '2026-08-24T18:00:00.900Z';

    await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });

    assert.equal(
      test.capability.calls[0]?.invocation.limits.maxDurationMs,
      100,
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

  void it('scopes idempotency keys to the initiating principal', async () => {
    const test = harness({ decision: responseDecision() });
    const owner = await test.lifecycle.submit({
      message: 'hello',
      requestKey: 'shared-request-key',
      principalId: 'owner_v1',
    });
    const collaborator = await test.lifecycle.submit({
      message: 'hello',
      requestKey: 'shared-request-key',
      principalId: 'collaborator_v1',
    });

    assert.notEqual(owner.task.id, collaborator.task.id);
    assert.equal(collaborator.task.principalId, 'collaborator_v1');
  });

  void it('cancels an awaiting-approval run without invoking the capability', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-cancel-pending',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);

    const cancelled = await test.lifecycle.cancelRun({
      runId: pending.run.id,
      principalId: 'owner_v1',
    });

    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(cancelled.task.status, 'cancelled');
    assert.equal(cancelled.run.approval?.status, 'rejected');
    assert.equal(test.capability.calls.length, 0);
    await assert.rejects(
      test.lifecycle.decideApproval({
        approvalId: approval.id,
        decision: 'approved',
        principalId: 'owner_v1',
      }),
      { code: 'approval_already_decided' },
    );
  });

  void it('does not overwrite cancellation when an in-flight model call fails', async () => {
    const evaluation = Promise.withResolvers<DecisionResult>();
    const test = harness({ evaluate: () => evaluation.promise });
    const submitted = test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-cancel-deciding',
      principalId: 'owner_v1',
    });
    let deciding = (await test.store.findRecoverable()).find(
      (aggregate) => aggregate.run.status === 'deciding',
    );
    while (deciding === undefined) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      deciding = (await test.store.findRecoverable()).find(
        (aggregate) => aggregate.run.status === 'deciding',
      );
    }
    while (test.evaluations() === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await test.lifecycle.cancelRun({
      runId: deciding.run.id,
      principalId: 'owner_v1',
    });
    evaluation.reject(new Error('model call failed after cancellation'));
    const cancelled = await submitted;

    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(cancelled.run.failure?.code, 'cancelled');
  });

  void it('rejects context whose content does not match its manifest', async () => {
    const test = harness({
      decision: planningDecision(),
      contextAssembler: {
        assemble: (input) =>
          Promise.resolve({
            manifest: {
              schemaVersion: 1,
              projectId: input.project.id,
              sourceKind: 'local_git',
              revision: 'tampered',
              generatedAt: '2026-08-24T18:00:00.000Z',
              entries: [
                {
                  relativePath: 'src/tampered.ts',
                  sha256: '0'.repeat(64),
                  bytes: 8,
                  selectionReason: 'Synthetic tampering test.',
                  classification: 'source_code',
                },
              ],
              totalFiles: 1,
              totalBytes: 8,
              limits: input.limits,
              exclusions: ['Synthetic context.'],
            },
            documents: [
              {
                relativePath: 'src/tampered.ts',
                sha256: '0'.repeat(64),
                content: 'tampered',
              },
            ],
          }),
      },
    });

    const failed = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-tampered-context',
      principalId: 'owner_v1',
    });

    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.failure?.code, 'project_context_failure');
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

  void it('resumes one durably claimed invocation during startup recovery', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-recover-executing',
      principalId: 'owner_v1',
    });
    const interrupted = structuredClone(pending);
    const approval = interrupted.run.approval;
    const context = interrupted.run.context;
    assert.ok(approval);
    assert.ok(context);
    interrupted.version += 1;
    interrupted.run.status = 'executing';
    approval.status = 'approved';
    approval.decidedAt = '2026-08-24T18:00:00.000Z';
    approval.decidedBy = 'owner_v1';
    interrupted.run.invocation = {
      id: 'invocation_recovery_test',
      status: 'executing',
      capability: approval.capability,
      arguments: approval.proposedArguments,
      project: approval.project,
      contextManifest: context.manifest,
      startedAt: '2026-08-24T18:00:00.000Z',
    };
    assert.ok(interrupted.run.budget);
    interrupted.run.budget.consumed.capabilityInvocations = 1;
    assert.equal(await test.store.replace(interrupted, pending.version), true);

    await test.lifecycle.recoverInterrupted();
    const recovered = await test.lifecycle.getRun(
      'owner_v1',
      interrupted.run.id,
    );

    assert.equal(recovered.run.status, 'succeeded');
    assert.equal(recovered.run.invocation?.id, 'invocation_recovery_test');
    assert.equal(recovered.run.budget?.consumed.retries, 1);
    assert.equal(test.capability.calls.length, 1);
  });

  void it('finalizes a durable cancellation request during startup recovery', async () => {
    const test = harness({ decision: planningDecision() });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-recover-cancellation',
      principalId: 'owner_v1',
    });
    const interrupted = structuredClone(pending);
    const approval = interrupted.run.approval;
    const context = interrupted.run.context;
    assert.ok(approval);
    assert.ok(context);
    interrupted.version += 1;
    interrupted.run.status = 'cancellation_requested';
    approval.status = 'approved';
    approval.decidedAt = '2026-08-24T18:00:00.000Z';
    approval.decidedBy = 'owner_v1';
    interrupted.run.invocation = {
      id: 'invocation_cancel_recovery_test',
      status: 'executing',
      capability: approval.capability,
      arguments: approval.proposedArguments,
      project: approval.project,
      contextManifest: context.manifest,
      startedAt: '2026-08-24T18:00:00.000Z',
    };
    assert.equal(await test.store.replace(interrupted, pending.version), true);

    await test.lifecycle.recoverInterrupted();
    const recovered = await test.lifecycle.getRun(
      'owner_v1',
      interrupted.run.id,
    );

    assert.equal(recovered.run.status, 'cancelled');
    assert.equal(recovered.task.status, 'cancelled');
    assert.equal(recovered.run.failure?.code, 'cancelled');
    assert.equal(test.capability.calls.length, 0);
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

    await test.lifecycle.getRun('owner_v1', pending.run.id);

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
