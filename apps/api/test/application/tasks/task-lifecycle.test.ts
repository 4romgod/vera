import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { InMemoryScratchpad } from '../../../src/adapters/outbound/persistence/memory/in-memory-scratchpad.ts';
import {
  LifecycleError,
  createTaskLifecycle,
} from '../../../src/application/tasks/task-lifecycle.ts';
import type { EvaluateModelDecision } from '../../../src/application/model-decisions/evaluate-model-decision.ts';
import type { EvaluateGoalContinuation } from '../../../src/application/model-decisions/evaluate-goal-continuation.ts';
import type { ConversationMessage } from '../../../src/domain/conversations/conversation.ts';
import type { DecisionResult } from '../../../src/domain/model/execution-decision.ts';
import type { DevelopmentPlan } from '../../../src/domain/plans/development-plan.ts';
import type { RunBudget } from '../../../src/domain/tasks/run-budget.ts';
import { CapabilityInvocationSchema } from '../../../src/domain/tasks/task-aggregate.ts';
import { sameCapabilityDestination } from '../../../src/domain/capabilities/capability-destination.ts';
import { ModelProviderError } from '../../../src/ports/model/model-provider.ts';
import type {
  DevelopmentPlanningCapability,
  DevelopmentPlanningCapabilityRegistry,
  DevelopmentPlanningInvocation,
} from '../../../src/ports/capabilities/development-planning-capability.ts';
import type { CapabilityRuntimeRegistry } from '../../../src/ports/capabilities/capability-runtime.ts';
import type { ProjectContextAssembler } from '../../../src/ports/projects/project-context-assembler.ts';
import { createDeterministicSoftwareChangeRegistry } from '../../support/deterministic-software-change-registry.ts';
import { createTestCapabilityRuntime } from '../../support/test-capability-runtime.ts';
import { findCapability } from '../../../src/domain/capabilities/capability-registry.ts';
import type { CapabilityRuntime } from '../../../src/ports/capabilities/capability-runtime.ts';
import type { SoftwareDeliveryContext } from '../../../src/domain/software-delivery/software-delivery-management.ts';
import { InMemoryExternalSignalStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-external-signal-store.ts';
import type { ExternalSignalStore } from '../../../src/ports/persistence/external-signal-store.ts';
import { ExternalSignalSchema } from '../../../src/domain/external-awareness/external-signal.ts';

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

function softwareChangeDecision(): DecisionResult {
  const proposedArguments = {
    objective: 'Implement request tracing.',
    ticket: { reference: 'VERA-203', details: 'Trace every API request.' },
    project: { name: 'Vera' },
  };
  return {
    decisionId: 'decision_change_test',
    proposal: {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'An isolated software change is appropriate.',
      capability: { name: 'software_change', version: 1 },
      arguments: proposedArguments,
    },
    decision: {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'software_change', version: 1 },
      proposedArguments,
    },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function missionDecision(): DecisionResult {
  const proposedArguments = {
    action: 'create' as const,
    objective: 'Select and deliver one useful Vera improvement.',
    completionCriteria: 'One verified pull request is ready for review.',
    project: { name: 'Vera' },
    delivery: {
      commitMessage: 'feat: complete bounded mission',
      pullRequestTitle: 'Complete bounded mission',
    },
  };
  return {
    decisionId: 'decision_mission_test',
    proposal: {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Draft one bounded mission.',
      capability: { name: 'mission_management', version: 1 },
      arguments: proposedArguments,
    },
    decision: {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'mission_management', version: 1 },
      proposedArguments,
    },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function missionCapabilityRegistry(): CapabilityRuntimeRegistry {
  const definition = findCapability('mission_management', 1);
  assert.ok(definition);
  const destination = {
    schemaVersion: 1 as const,
    adapterId: 'bounded_mission',
    provider: 'vera',
    transport: 'in_process' as const,
    dataBoundary: 'owner_controlled' as const,
  };
  const authority = definition.authority;
  const runtime: CapabilityRuntime = {
    definition,
    destination,
    authority,
    authorityFor: () => authority,
    checkReadiness: () => Promise.resolve(),
    execute: () =>
      Promise.resolve({
        artifact: {
          type: 'mission_management_result',
          mediaType: 'application/vnd.vera.mission-management-result+json',
          content: {
            schemaVersion: 1,
            action: 'create',
            summary: 'Mission draft prepared for one owner approval.',
            mission: {
              id: 'mission_task_test',
              status: 'awaiting_approval',
              objective: 'Select and deliver one useful Vera improvement.',
            },
          },
        },
        model: { provider: 'vera', model: 'bounded_mission', durationMs: 1 },
      }),
  };
  return {
    declarations: () => [{ definition, authority, enabled: true, destination }],
    enabledReferences: () => [{ name: 'mission_management', version: 1 }],
    selected: (reference) =>
      reference.name === 'mission_management' && reference.version === 1
        ? runtime
        : null,
    resolve: (reference, candidate) =>
      reference.name === 'mission_management' &&
      reference.version === 1 &&
      sameCapabilityDestination(destination, candidate)
        ? runtime
        : null,
  };
}

function softwareDeliveryDecision(): DecisionResult {
  const proposedArguments = {
    action: 'list' as const,
    scope: 'active' as const,
  };
  return {
    decisionId: 'decision_software_delivery_test',
    proposal: {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'List active software deliveries.',
      capability: { name: 'software_delivery_management', version: 1 },
      arguments: proposedArguments,
    },
    decision: {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'software_delivery_management', version: 1 },
      proposedArguments,
    },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function softwareDeliveryCapabilityRegistry(): CapabilityRuntimeRegistry {
  const definition = findCapability('software_delivery_management', 1);
  assert.ok(definition);
  const destination = {
    schemaVersion: 1 as const,
    adapterId: 'software_delivery_control',
    provider: 'vera',
    transport: 'in_process' as const,
    dataBoundary: 'owner_controlled' as const,
  };
  const runtime: CapabilityRuntime = {
    definition,
    destination,
    authority: definition.authority,
    authorityFor: () => ({
      ...definition.authority,
      networkAccess: 'none',
      sideEffects: [],
      credentials: 'none',
    }),
    checkReadiness: () => Promise.resolve(),
    execute: () =>
      Promise.resolve({
        artifact: {
          type: 'software_delivery_management_result',
          mediaType:
            'application/vnd.vera.software-delivery-management-result+json',
          content: {
            schemaVersion: 1,
            action: 'list',
            summary: 'No active software deliveries.',
            resources: [],
          },
        },
        model: {
          provider: 'vera',
          model: 'software_delivery_control',
          durationMs: 1,
        },
      }),
  };
  return {
    declarations: () => [
      {
        definition,
        authority: definition.authority,
        enabled: true,
        destination,
      },
    ],
    enabledReferences: () => [
      { name: 'software_delivery_management', version: 1 },
    ],
    selected: () => runtime,
    resolve: (_reference, candidate) =>
      sameCapabilityDestination(destination, candidate) ? runtime : null,
  };
}

function personalTaskDecision(
  proposedArguments:
    | { action: 'create'; title: string }
    | { action: 'list'; status: 'all' | 'open' | 'completed' }
    | { action: 'complete' | 'reopen'; taskId: string },
): DecisionResult {
  return {
    decisionId: `decision_personal_task_${proposedArguments.action}`,
    proposal: {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'The owner requested a personal task action.',
      capability: { name: 'personal_task_management', version: 1 },
      arguments: proposedArguments,
    },
    decision: {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'personal_task_management', version: 1 },
      proposedArguments,
    },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function goalDecision(): DecisionResult {
  const planningArguments = {
    objective: 'Add request tracing.',
    ticket: { reference: 'VERA-202', details: 'Trace every API request.' },
    project: { name: 'Vera' },
  };
  const changeArguments = {
    objective: 'Implement request tracing.',
    ticket: { reference: 'VERA-203', details: 'Trace every API request.' },
    project: { name: 'Vera' },
  };
  const goal = {
    schemaVersion: 1 as const,
    objective: 'Plan and implement request tracing.',
    summary:
      'Prepare an evidence-bounded plan and use it to produce an isolated change.',
    steps: [
      {
        id: 'step_plan',
        purpose: 'Prepare the implementation plan.',
        inputStepIds: [],
        capability: 'development_planning' as const,
        version: 1 as const,
        arguments: planningArguments,
      },
      {
        id: 'step_change',
        purpose: 'Implement the approved plan.',
        inputStepIds: ['step_plan'],
        capability: 'software_change' as const,
        version: 1 as const,
        arguments: changeArguments,
      },
    ],
  };
  return {
    decisionId: 'decision_goal_test',
    proposal: {
      schemaVersion: 1,
      kind: 'execute_goal',
      decisionSummary: 'The owner requested two dependent outcomes.',
      goal,
    },
    decision: { kind: 'goal_planned', plan: goal },
    model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
  };
}

function adaptiveGoalDecision(firstStepId = 'step_1'): DecisionResult {
  const goal = {
    schemaVersion: 1 as const,
    objective: 'Research the forecast and conditionally create a reminder.',
    summary: 'Observe the forecast before choosing the next action.',
    completionCriteria:
      'Create a reminder only when the evidence supports it, then explain the outcome.',
    requirements: [
      {
        id: 'requirement_research',
        description: 'Research the forecast.',
        capability: 'web_research',
        version: 1,
        condition: { kind: 'always' as const },
      },
      {
        id: 'requirement_reminder',
        description: 'Create the reminder if rain is expected.',
        capability: 'personal_reminder_management',
        version: 1,
        condition: {
          kind: 'evidence_dependent' as const,
          description: 'The forecast evidence predicts rain.',
        },
      },
    ],
    firstStep: {
      id: firstStepId,
      purpose: 'Research the forecast.',
      inputStepIds: [],
      capability: 'web_research' as const,
      version: 1 as const,
      arguments: { objective: 'Check whether rain is expected tomorrow.' },
    },
  };
  return {
    decisionId: 'decision_adaptive_goal',
    proposal: {
      schemaVersion: 1,
      kind: 'pursue_goal',
      decisionSummary: 'The next action depends on unseen evidence.',
      goal,
    },
    decision: { kind: 'adaptive_goal_planned', plan: goal },
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

class FailOnceReplyResourceStore extends InMemoryOwnerResourceStore {
  private shouldFail = true;

  public override appendMessage(
    ...args: Parameters<InMemoryOwnerResourceStore['appendMessage']>
  ): ReturnType<InMemoryOwnerResourceStore['appendMessage']> {
    if (args[2].role === 'vera' && this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error('Synthetic reply projection failure.'));
    }
    return super.appendMessage(...args);
  }
}

class TamperedArtifactResourceStore extends InMemoryOwnerResourceStore {
  public tamperReads = false;

  public override async findArtifactById(
    ...args: Parameters<InMemoryOwnerResourceStore['findArtifactById']>
  ): ReturnType<InMemoryOwnerResourceStore['findArtifactById']> {
    const artifact = await super.findArtifactById(...args);
    if (!this.tamperReads || artifact?.type !== 'research_report') {
      return artifact;
    }
    return {
      ...artifact,
      content: {
        ...artifact.content,
        report: `${artifact.content.report} tampered`,
      },
    };
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
  evaluate?: EvaluateModelDecision;
  evaluateGoalContinuation?: EvaluateGoalContinuation;
  capability?: FakePlanningCapability;
  registry?: DevelopmentPlanningCapabilityRegistry;
  capabilities?: CapabilityRuntimeRegistry;
  budget?: RunBudget;
  clock?: () => string;
  contextAssembler?: ProjectContextAssembler;
  executionMode?: 'inline' | 'worker';
  resources?: InMemoryOwnerResourceStore;
  softwareDeliveryContext?: {
    assemble(principalId: string): Promise<SoftwareDeliveryContext>;
  };
  externalSignals?: ExternalSignalStore;
}) {
  const store = new InMemoryExecutionStore();
  const resources = options?.resources ?? new InMemoryOwnerResourceStore();
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
  const warnings: unknown[] = [];
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
    evaluateModelDecision: async (message, context) => {
      evaluations += 1;
      return options?.evaluate === undefined
        ? (options?.decision ?? responseDecision())
        : options.evaluate(message, context);
    },
    ...(options?.evaluateGoalContinuation === undefined
      ? {}
      : { evaluateGoalContinuation: options.evaluateGoalContinuation }),
    capabilities:
      options?.capabilities ??
      createTestCapabilityRuntime({
        developmentPlanning: options?.registry ?? registryFor(capability),
        softwareChange: createDeterministicSoftwareChangeRegistry(),
        webResearch: 'deterministic_research',
        personalTaskStore: resources,
        reminderStore: resources,
      }),
    resources,
    contextAssembler,
    ...(options?.softwareDeliveryContext === undefined
      ? {}
      : { softwareDeliveryContext: options.softwareDeliveryContext }),
    ...(options?.externalSignals === undefined
      ? {}
      : { externalSignals: options.externalSignals }),
    observer: {
      warning: (error) => warnings.push(error),
    },
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
    warnings,
    evaluations: () => evaluations,
  };
}

void describe('task lifecycle', () => {
  void it('fails closed before model evaluation when frozen signal evidence becomes stale', async () => {
    const signals = new InMemoryExternalSignalStore();
    const signal = ExternalSignalSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: 'external_signal_lifecycle_test',
      principalId: 'owner_v1',
      routineId: 'routine_lifecycle_test',
      integrationId: 'github',
      connectionId: 'connection_lifecycle_test',
      project: { id: 'project_test', displayName: 'Vera' },
      repository: { provider: 'github', owner: '4romgod', name: 'vera' },
      externalKey: 'pull:42:failed-checks',
      category: 'failed_check',
      title: 'Checks failed on #42',
      summary: 'quality-gate failed.',
      url: 'https://github.com/4romgod/vera/pull/42',
      occurredAt: '2026-08-24T18:00:00.000Z',
      status: 'active',
      firstObservedAt: '2026-08-24T18:00:00.000Z',
      lastObservedAt: '2026-08-24T18:00:00.000Z',
    });
    await signals.upsert(signal);
    const test = harness({ externalSignals: signals, executionMode: 'worker' });
    const submitted = await test.lifecycle.submit({
      principalId: 'owner_v1',
      requestKey: 'signal-lifecycle-task',
      message: 'Plan and fix this failed check.',
      externalSignalId: signal.id,
    });
    assert.equal(submitted.task.externalSignal?.version, 1);
    assert.equal(
      submitted.run.externalSignalContext?.manifest.signalId,
      signal.id,
    );
    await signals.upsert({ ...signal, summary: 'A new failure replaced it.' });

    const failed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );

    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.failure?.code, 'external_signal_context_failure');
    assert.equal(test.evaluations(), 0);
  });
  void it('automatically executes a non-consequential mission draft write but leaves the mission awaiting owner approval', async () => {
    const test = harness({
      decision: missionDecision(),
      capabilities: missionCapabilityRegistry(),
      executionMode: 'worker',
    });
    const submitted = await test.lifecycle.submit({
      principalId: 'owner_v1',
      requestKey: 'mission-draft-task',
      message: 'Run one bounded mission while I am away.',
    });
    const decided = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(decided.run.status, 'awaiting_approval');
    assert.equal(decided.run.approval?.status, 'approved');
    assert.equal(decided.run.approval.decidedBy, 'vera_policy');

    const completed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(completed.run.status, 'succeeded');
    assert.equal(completed.run.output?.kind, 'mission_management_result');
  });
  void it('assembles delivery context and automatically executes a read-only conversational control action', async () => {
    let assembledFor: string | undefined;
    let evaluatedContext: Parameters<EvaluateModelDecision>[1];
    const test = harness({
      decision: softwareDeliveryDecision(),
      evaluate: (_message, context) => {
        evaluatedContext = context;
        return Promise.resolve(softwareDeliveryDecision());
      },
      capabilities: softwareDeliveryCapabilityRegistry(),
      executionMode: 'worker',
      softwareDeliveryContext: {
        assemble(principalId) {
          assembledFor = principalId;
          return Promise.resolve({
            schemaVersion: 1,
            generatedAt: '2026-08-24T18:00:00.000Z',
            resources: [],
          });
        },
      },
    });
    const submitted = await test.lifecycle.submit({
      principalId: 'owner_v1',
      requestKey: 'software-delivery-list',
      message: 'Show my active missions and campaigns.',
    });
    const decided = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(assembledFor, 'owner_v1');
    assert.deepEqual(evaluatedContext?.softwareDeliveryContext, {
      schemaVersion: 1,
      generatedAt: '2026-08-24T18:00:00.000Z',
      resources: [],
    });
    assert.equal(
      decided.run.approval?.status,
      'approved',
      `${JSON.stringify(decided.run)} ${test.warnings.map(String).join(' | ')}`,
    );
    assert.equal(decided.run.approval.decidedBy, 'vera_policy');

    const completed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(completed.run.status, 'succeeded');
    assert.equal(
      completed.run.output?.kind,
      'software_delivery_management_result',
    );
  });
  void it('anchors temporal context to the durable task creation instant', async () => {
    let now = '2026-08-26T10:00:00.000Z';
    let evaluatedContext: Parameters<EvaluateModelDecision>[1];
    const test = harness({
      executionMode: 'worker',
      clock: () => now,
      evaluate: (_message, context) => {
        evaluatedContext = context;
        return Promise.resolve(responseDecision());
      },
    });
    const submitted = await test.lifecycle.submit({
      principalId: 'owner_v1',
      requestKey: 'temporal-anchor',
      message: 'Remind me in five minutes.',
    });

    now = '2026-08-26T10:00:01.000Z';
    for (
      let attempt = 0;
      attempt < 20 && evaluatedContext === undefined;
      attempt += 1
    ) {
      await test.lifecycle.progressTask('owner_v1', submitted.task.id);
    }

    assert.deepEqual(evaluatedContext?.temporalContext, {
      currentTime: '2026-08-26T10:00:00.000Z',
    });
  });

  void it('creates, lists, and completes a durable personal task through exact action authority', async () => {
    const taskIdentity: { value?: string } = {};
    const test = harness({
      evaluate: (message) => {
        if (message === 'create') {
          return Promise.resolve(
            personalTaskDecision({ action: 'create', title: 'Buy milk' }),
          );
        }
        if (message === 'list') {
          return Promise.resolve(
            personalTaskDecision({ action: 'list', status: 'open' }),
          );
        }
        if (taskIdentity.value === undefined) {
          throw new Error('Task identity is missing.');
        }
        return Promise.resolve(
          personalTaskDecision({
            action: 'complete',
            taskId: taskIdentity.value,
          }),
        );
      },
    });

    const create = await test.lifecycle.submit({
      message: 'create',
      requestKey: 'personal-task-create',
      principalId: 'owner_v1',
    });
    assert.ok(create.run.approval);
    const createApproval = create.run.approval;
    assert.ok(createApproval.authority);
    assert.equal(createApproval.authority.networkAccess, 'none');
    assert.deepEqual(createApproval.authority.sideEffects, [
      'personal_data_write',
    ]);
    assert.equal(createApproval.project, undefined);
    const created = await test.lifecycle.decideApproval({
      principalId: 'owner_v1',
      approvalId: createApproval.id,
      decision: 'approved',
    });
    assert.equal(created.run.status, 'succeeded');
    const createdOutput = created.run.output;
    assert.ok(createdOutput);
    assert.equal(createdOutput.kind, 'personal_task_result');
    const createdTask = createdOutput.result.tasks[0];
    assert.ok(createdTask);
    const taskId = createdTask.id;
    taskIdentity.value = taskId;
    assert.equal(createdTask.title, 'Buy milk');
    assert.equal(createdTask.status, 'open');
    assert.ok(createdOutput.artifact);
    assert.equal(createdOutput.artifact.type, 'personal_task_result');

    const list = await test.lifecycle.submit({
      message: 'list',
      requestKey: 'personal-task-list',
      principalId: 'owner_v1',
    });
    assert.ok(list.run.approval);
    assert.ok(list.run.approval.authority);
    assert.deepEqual(list.run.approval.authority.sideEffects, []);
    const listed = await test.lifecycle.decideApproval({
      principalId: 'owner_v1',
      approvalId: list.run.approval.id,
      decision: 'approved',
    });
    const listedOutput = listed.run.output;
    assert.ok(listedOutput);
    assert.equal(listedOutput.kind, 'personal_task_result');
    assert.equal(listedOutput.result.tasks[0]?.id, taskId);

    const complete = await test.lifecycle.submit({
      message: 'complete',
      requestKey: 'personal-task-complete',
      principalId: 'owner_v1',
    });
    assert.ok(complete.run.approval);
    const completed = await test.lifecycle.decideApproval({
      principalId: 'owner_v1',
      approvalId: complete.run.approval.id,
      decision: 'approved',
    });
    assert.ok(completed.run.output);
    assert.equal(completed.run.output.kind, 'personal_task_result');
    const durable = await test.resources.findPersonalTaskById(
      'owner_v1',
      taskId,
    );
    assert.equal(durable?.status, 'completed');
    assert.equal(
      (
        await test.resources.listPersonalTasks('another_owner', {
          status: 'all',
          limit: 100,
        })
      ).length,
      0,
    );
  });

  void it('executes a bounded goal through separate approvals and typed artifact lineage', async () => {
    const test = harness({ decision: goalDecision() });
    const submitted = await test.lifecycle.submit({
      message: 'Plan and implement request tracing.',
      requestKey: 'goal-request',
      principalId: 'owner_v1',
    });

    assert.equal(submitted.run.status, 'awaiting_approval');
    assert.ok(submitted.run.goal);
    assert.ok(submitted.run.approval);
    assert.equal(submitted.run.goal.steps.length, 2);
    assert.equal(
      submitted.run.approval.capability.name,
      'development_planning',
    );
    assert.equal(submitted.run.approval.inputArtifacts, undefined);

    const afterPlanning = await test.lifecycle.decideApproval({
      approvalId: submitted.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    assert.equal(afterPlanning.run.status, 'awaiting_approval');
    assert.ok(afterPlanning.run.goal);
    assert.ok(afterPlanning.run.goal.steps[0]);
    assert.ok(afterPlanning.run.goal.steps[1]);
    assert.ok(afterPlanning.run.approval);
    assert.ok(afterPlanning.run.approval.inputArtifacts?.[0]);
    assert.ok(afterPlanning.run.approvalHistory?.[0]);
    assert.ok(afterPlanning.run.invocationHistory?.[0]);
    assert.equal(afterPlanning.run.goal.steps[0].status, 'succeeded');
    assert.equal(afterPlanning.run.goal.steps[1].status, 'awaiting_approval');
    assert.equal(afterPlanning.run.approval.capability.name, 'software_change');
    assert.equal(afterPlanning.run.approval.inputArtifacts.length, 1);
    assert.equal(
      afterPlanning.run.approval.inputArtifacts[0].type,
      'implementation_plan',
    );
    assert.ok(
      afterPlanning.run.approval.authority?.dataClasses.includes(
        'artifact_content',
      ),
    );
    assert.equal(afterPlanning.run.approvalHistory.length, 1);
    assert.equal(
      afterPlanning.run.approvalHistory[0].id,
      submitted.run.approval.id,
    );
    assert.equal(afterPlanning.run.approvalHistory[0].status, 'approved');
    assert.equal(afterPlanning.run.invocationHistory.length, 1);
    assert.equal(afterPlanning.run.invocationHistory[0].status, 'succeeded');

    const replayedPriorApproval = await test.lifecycle.decideApproval({
      approvalId: submitted.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    assert.ok(replayedPriorApproval.run.approval);
    assert.equal(
      replayedPriorApproval.run.approval.id,
      afterPlanning.run.approval.id,
    );
    assert.equal(replayedPriorApproval.run.status, 'awaiting_approval');
    await assert.rejects(
      test.lifecycle.decideApproval({
        approvalId: submitted.run.approval.id,
        decision: 'rejected',
        principalId: 'owner_v1',
      }),
      (error: unknown) =>
        error instanceof LifecycleError &&
        error.code === 'approval_already_decided',
    );

    const completed = await test.lifecycle.decideApproval({
      approvalId: afterPlanning.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    assert.equal(
      completed.run.status,
      'succeeded',
      JSON.stringify({
        failure: completed.run.failure,
        warnings: test.warnings.map(String),
      }),
    );
    assert.ok(completed.run.goal);
    assert.equal(completed.run.goal.status, 'succeeded');
    if (completed.run.output?.kind !== 'goal_result') {
      throw new Error('The completed goal did not return a goal result.');
    }
    const goalOutput = completed.run.output;
    assert.equal(goalOutput.artifacts.length, 2);
    assert.ok(goalOutput.artifacts[0]);
    assert.ok(goalOutput.artifacts[1]);
    const changeArtifact = await test.resources.findArtifactById(
      'owner_v1',
      goalOutput.artifacts[1].id,
    );
    assert.ok(changeArtifact);
    assert.equal(changeArtifact.inputs?.length, 1);
    assert.ok(changeArtifact.inputs[0]);
    assert.equal(changeArtifact.inputs[0].id, goalOutput.artifacts[0].id);
    assert.deepEqual(
      completed.events
        .filter((event) => event.type.startsWith('goal_'))
        .map((event) => event.type),
      [
        'goal_planned',
        'goal_step_awaiting_approval',
        'goal_step_succeeded',
        'goal_step_awaiting_approval',
        'goal_step_succeeded',
        'goal_succeeded',
      ],
    );
  });

  void it('observes, decides, acts, and completes an adaptive goal across recovery boundaries', async () => {
    let continuationCalls = 0;
    const evaluateGoalContinuation: EvaluateGoalContinuation = (input) => {
      continuationCalls += 1;
      assert.equal(input.observations.length, continuationCalls);
      if (continuationCalls === 1) {
        const proposal = {
          schemaVersion: 1 as const,
          kind: 'continue_goal' as const,
          decisionSummary: 'The evidence supports the conditional reminder.',
          evidenceStepIds: ['step_1'],
          step: {
            id: 'step_2',
            purpose: 'Create the requested reminder.',
            inputStepIds: [],
            capability: 'personal_reminder_management' as const,
            version: 1 as const,
            arguments: {
              action: 'create' as const,
              message: 'Take an umbrella.',
              scheduledFor: '2030-01-02T05:00:00.000Z',
              timeZone: 'UTC',
            },
          },
        };
        return Promise.resolve({
          decisionId: 'decision_continue_reminder',
          proposal,
          decision: {
            kind: 'continue_goal',
            step: proposal.step,
            evidenceStepIds: proposal.evidenceStepIds,
          },
          model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
          decidedAt: '2026-08-24T18:00:00.000Z',
        });
      }
      const proposal = {
        schemaVersion: 1 as const,
        kind: 'complete_goal' as const,
        decisionSummary: 'The research and reminder satisfy the request.',
        message:
          'The evidence supported the condition, so I created the umbrella reminder.',
        evidenceStepIds: ['step_1', 'step_2'],
        requirementResolutions: [
          {
            requirementId: 'requirement_research',
            status: 'satisfied' as const,
            evidenceStepIds: ['step_1'],
          },
          {
            requirementId: 'requirement_reminder',
            status: 'satisfied' as const,
            evidenceStepIds: ['step_2'],
          },
        ],
      };
      return Promise.resolve({
        decisionId: 'decision_complete_adaptive_goal',
        proposal,
        decision: {
          kind: 'complete_goal',
          message: proposal.message,
          evidenceStepIds: proposal.evidenceStepIds,
          requirementResolutions: proposal.requirementResolutions,
        },
        model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
        decidedAt: '2026-08-24T18:00:00.000Z',
      });
    };
    const test = harness({
      decision: adaptiveGoalDecision(),
      evaluateGoalContinuation,
      executionMode: 'worker',
    });
    const submitted = await test.lifecycle.submit({
      message:
        'Research the forecast and if rain is expected remind me to take an umbrella.',
      requestKey: 'adaptive-goal-request',
      principalId: 'owner_v1',
    });

    const firstApproval = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(firstApproval.run.status, 'awaiting_approval');
    assert.equal(firstApproval.run.goal?.schemaVersion, 2);
    assert.ok(firstApproval.run.approval);
    await test.lifecycle.decideApproval({
      approvalId: firstApproval.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });

    const observedResearch = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(observedResearch.run.status, 'deciding');
    assert.equal(observedResearch.run.goal?.steps[0]?.status, 'succeeded');

    // Startup recovery discovers the durable deciding state and requests the
    // next exact approval without rerunning the completed research capability.
    await test.lifecycle.recoverInterrupted();
    const reminderApproval = await test.lifecycle.getTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(reminderApproval.run.status, 'awaiting_approval');
    assert.ok(reminderApproval.run.approval);
    assert.equal(
      reminderApproval.run.approval.capability.name,
      'personal_reminder_management',
    );
    assert.equal(reminderApproval.run.approval.inputArtifacts, undefined);
    const decisionEvidence = reminderApproval.run.approval.decisionEvidence;
    assert.ok(decisionEvidence);
    assert.equal(decisionEvidence.length, 1);
    assert.equal(decisionEvidence[0]?.type, 'research_report');
    assert.ok(
      reminderApproval.run.approval.authority?.dataClasses.includes(
        'artifact_content',
      ),
    );
    assert.equal(reminderApproval.run.approvalHistory?.length, 1);

    // Aggregates written before ADR-0032 displayed decision evidence but did
    // not classify the derived arguments as artifact content. Preserve that
    // already-issued approval across a rolling upgrade without broadening it.
    const legacyAggregate = await test.store.findByTaskId(
      'owner_v1',
      submitted.task.id,
    );
    assert.ok(legacyAggregate?.run.approval?.authority);
    legacyAggregate.run.approval.authority.dataClasses =
      legacyAggregate.run.approval.authority.dataClasses.filter(
        (dataClass) => dataClass !== 'artifact_content',
      );
    assert.equal(
      await test.store.replace(legacyAggregate, legacyAggregate.version),
      true,
    );

    await test.lifecycle.decideApproval({
      approvalId: reminderApproval.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    const observedReminder = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(observedReminder.run.status, 'deciding');

    await test.lifecycle.recoverInterrupted();
    const completed = await test.lifecycle.getTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(completed.run.status, 'succeeded');
    assert.equal(continuationCalls, 2);
    const completedBudget = completed.run.budget;
    assert.ok(completedBudget);
    assert.equal(completedBudget.consumed.modelCalls, 3);
    assert.equal(completedBudget.consumed.capabilityInvocations, 2);
    const completedGoal = completed.run.goal;
    assert.ok(completedGoal);
    assert.equal(completedGoal.status, 'succeeded');
    if (completedGoal.schemaVersion !== 2) {
      throw new Error('The adaptive goal schema was not preserved.');
    }
    assert.equal(completedGoal.continuations.length, 2);
    assert.equal(completedGoal.finalResponse?.evidence.length, 2);
    if (completed.run.output?.kind !== 'adaptive_goal_result') {
      throw new Error('The adaptive goal did not return its grounded result.');
    }
    assert.equal(completed.run.output.artifacts.length, 2);
    assert.equal(completed.run.output.evidence.length, 2);
    assert.match(
      completed.run.output.message,
      /created the umbrella reminder/u,
    );
    assert.match(
      completed.run.output.message,
      /Verified execution record: web_research@1, personal_reminder_management@1/u,
    );
    const reminders = await test.resources.listReminders('owner_v1', {
      status: 'scheduled',
      limit: 10,
    });
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0]?.message, 'Take an umbrella.');
    assert.deepEqual(
      completed.events
        .filter((event) => event.type.startsWith('adaptive_goal_'))
        .map((event) => event.type),
      [
        'adaptive_goal_planned',
        'adaptive_goal_observation_recorded',
        'adaptive_goal_continuation_recorded',
        'adaptive_goal_observation_recorded',
        'adaptive_goal_continuation_recorded',
        'adaptive_goal_succeeded',
      ],
    );
  });

  void it('keeps a model-authored not-applicable reason out of the owner response', async () => {
    const rawModelReason =
      'Rain is expected, so the reminder condition is met and no reminder is needed.';
    const test = harness({
      decision: adaptiveGoalDecision('step_2'),
      executionMode: 'worker',
      evaluateGoalContinuation: (input) => {
        assert.equal(input.nextStepId, 'step_3');
        return Promise.resolve({
          decisionId: 'decision_complete_without_reminder',
          proposal: {
            schemaVersion: 1,
            kind: 'complete_goal',
            decisionSummary: 'The conditional action was not applicable.',
            message: 'I researched the forecast and handled the condition.',
            evidenceStepIds: ['step_2'],
            requirementResolutions: [
              {
                requirementId: 'requirement_research',
                status: 'satisfied',
                evidenceStepIds: ['step_2'],
              },
              {
                requirementId: 'requirement_reminder',
                status: 'not_applicable',
                reason: rawModelReason,
                evidenceStepIds: ['step_2'],
              },
            ],
          },
          decision: {
            kind: 'complete_goal',
            message: 'I researched the forecast and handled the condition.',
            evidenceStepIds: ['step_2'],
            requirementResolutions: [
              {
                requirementId: 'requirement_research',
                status: 'satisfied',
                evidenceStepIds: ['step_2'],
              },
              {
                requirementId: 'requirement_reminder',
                status: 'not_applicable',
                reason: rawModelReason,
                evidenceStepIds: ['step_2'],
              },
            ],
          },
          model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
          decidedAt: '2026-08-24T18:00:00.000Z',
        });
      },
    });
    const submitted = await test.lifecycle.submit({
      message:
        'Research the forecast and if rain is expected remind me to take an umbrella.',
      requestKey: 'adaptive-not-applicable-response',
      principalId: 'owner_v1',
    });
    const awaitingApproval = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.ok(awaitingApproval.run.approval);
    await test.lifecycle.decideApproval({
      approvalId: awaitingApproval.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    await test.lifecycle.progressTask('owner_v1', submitted.task.id);
    await test.lifecycle.recoverInterrupted();

    const completed = await test.lifecycle.getTask(
      'owner_v1',
      submitted.task.id,
    );
    if (completed.run.output?.kind !== 'adaptive_goal_result') {
      throw new Error('The adaptive goal did not return its grounded result.');
    }
    assert.doesNotMatch(
      completed.run.output.message,
      new RegExp(rawModelReason),
    );
    assert.doesNotMatch(
      completed.run.output.message,
      /I researched the forecast and handled the condition/u,
    );
    assert.match(
      completed.run.output.message,
      /The orchestration brain judged its evidence-dependent condition not applicable\./u,
    );
    const completedGoal = completed.run.goal;
    assert.ok(completedGoal);
    assert.equal(completedGoal.schemaVersion, 2);
    const continuation = completedGoal.continuations[0];
    assert.ok(continuation);
    assert.equal(continuation.decision.kind, 'complete_goal');
    const reminderResolution = continuation.decision.requirementResolutions[1];
    assert.ok(reminderResolution);
    assert.equal(reminderResolution.status, 'not_applicable');
    assert.equal(reminderResolution.reason, rawModelReason);
  });

  void it('fails closed before continuation inference when a stored observation is corrupted', async () => {
    const resources = new TamperedArtifactResourceStore();
    let continuationCalls = 0;
    const test = harness({
      decision: adaptiveGoalDecision(),
      executionMode: 'worker',
      resources,
      evaluateGoalContinuation: () => {
        continuationCalls += 1;
        throw new Error('The continuation model must not be called.');
      },
    });
    const submitted = await test.lifecycle.submit({
      message: 'Research and decide conditionally.',
      requestKey: 'adaptive-tamper',
      principalId: 'owner_v1',
    });
    const awaitingApproval = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.ok(awaitingApproval.run.approval);
    await test.lifecycle.decideApproval({
      approvalId: awaitingApproval.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    const observed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(observed.run.status, 'deciding');

    resources.tamperReads = true;
    const failed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );

    assert.equal(continuationCalls, 0);
    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.failure?.code, 'adaptive_goal_failure');
    assert.ok(
      test.warnings.some((warning) =>
        String(warning).includes('failed integrity or scope validation'),
      ),
    );
  });

  void it('stops a goal when its current step is rejected', async () => {
    const test = harness({ decision: goalDecision() });
    const submitted = await test.lifecycle.submit({
      message: 'Plan and implement request tracing.',
      requestKey: 'goal-rejected',
      principalId: 'owner_v1',
    });
    assert.ok(submitted.run.approval);

    const rejected = await test.lifecycle.decideApproval({
      approvalId: submitted.run.approval.id,
      decision: 'rejected',
      principalId: 'owner_v1',
    });

    assert.equal(rejected.run.status, 'rejected');
    assert.ok(rejected.run.goal);
    assert.ok(rejected.run.goal.steps[0]);
    assert.ok(rejected.run.goal.steps[1]);
    assert.equal(rejected.run.goal.status, 'rejected');
    assert.equal(rejected.run.goal.steps[0].status, 'rejected');
    assert.equal(rejected.run.goal.steps[1].status, 'pending');
    assert.equal(rejected.run.invocation, undefined);
  });

  void it('cancels a goal at the next approval without undoing completed evidence', async () => {
    const test = harness({ decision: goalDecision() });
    const submitted = await test.lifecycle.submit({
      message: 'Plan and implement request tracing.',
      requestKey: 'goal-cancelled',
      principalId: 'owner_v1',
    });
    assert.ok(submitted.run.approval);
    const afterPlanning = await test.lifecycle.decideApproval({
      approvalId: submitted.run.approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });
    assert.ok(afterPlanning.run.goal);
    assert.ok(afterPlanning.run.goal.steps[0]);

    const cancelled = await test.lifecycle.cancelRun({
      runId: submitted.run.id,
      principalId: 'owner_v1',
    });

    assert.equal(afterPlanning.run.goal.steps[0].status, 'succeeded');
    assert.equal(cancelled.run.status, 'cancelled');
    assert.ok(cancelled.run.goal);
    assert.ok(cancelled.run.goal.steps[0]);
    assert.ok(cancelled.run.goal.steps[1]);
    assert.ok(cancelled.run.approval);
    assert.equal(cancelled.run.goal.status, 'cancelled');
    assert.equal(cancelled.run.goal.steps[0].status, 'succeeded');
    assert.equal(cancelled.run.goal.steps[1].status, 'cancelled');
    assert.equal(cancelled.run.approval.status, 'rejected');
  });

  void it('freezes completed same-scope turns and projects one durable Vera reply', async () => {
    const evaluations: Parameters<EvaluateModelDecision>[1][] = [];
    let evaluation = 0;
    const test = harness({
      evaluate: (_message, context) => {
        evaluations.push(context);
        evaluation += 1;
        return Promise.resolve(responseDecision(`Reply ${String(evaluation)}`));
      },
    });
    await test.resources.createConversation({
      schemaVersion: 1,
      id: 'conversation_test',
      principalId: 'owner_v1',
      creationKey: 'conversation-test',
      title: 'Test conversation',
      status: 'active',
      messages: [],
      createdAt: '2026-08-24T18:00:00.000Z',
      updatedAt: '2026-08-24T18:00:00.000Z',
    });

    const submitTurn = async (turn: number) => {
      const ownerMessage: ConversationMessage = {
        id: `message_owner_${String(turn)}`,
        requestKey: `owner-${String(turn)}`,
        role: 'owner',
        content: `Message ${String(turn)}`,
        projectId: 'project_test',
        createdAt: '2026-08-24T18:00:00.000Z',
      };
      await test.resources.appendMessage(
        'owner_v1',
        'conversation_test',
        ownerMessage,
      );
      const aggregate = await test.lifecycle.submit({
        message: ownerMessage.content,
        requestKey: ownerMessage.id,
        principalId: 'owner_v1',
        conversationId: 'conversation_test',
        messageId: ownerMessage.id,
      });
      await test.resources.attachTaskToMessage(
        'owner_v1',
        'conversation_test',
        ownerMessage.id,
        aggregate.task.id,
      );
      return aggregate;
    };

    const first = await submitTurn(1);
    assert.equal(first.run.conversationReply?.status, 'projected');
    const second = await submitTurn(2);

    const secondContext = second.run.conversationContext;
    assert.ok(secondContext);
    assert.equal(secondContext.manifest.totalMessages, 2);
    assert.deepEqual(
      secondContext.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      [
        { role: 'owner', content: 'Message 1' },
        { role: 'vera', content: 'Reply 1' },
      ],
    );
    assert.deepEqual(evaluations[1]?.conversationContext, secondContext);
    assert.deepEqual(
      second.events.slice(-2).map((event) => event.type),
      ['conversation_reply_pending', 'conversation_reply_projected'],
    );
    const storedConversation = await test.resources.findConversationById(
      'owner_v1',
      'conversation_test',
    );
    assert.ok(storedConversation);
    assert.equal(storedConversation.messages.length, 4);
    assert.deepEqual(
      storedConversation.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      [
        { role: 'owner', content: 'Message 1' },
        { role: 'vera', content: 'Reply 1' },
        { role: 'owner', content: 'Message 2' },
        { role: 'vera', content: 'Reply 2' },
      ],
    );

    const repeated = await test.lifecycle.submit({
      message: 'Message 2',
      requestKey: 'message_owner_2',
      principalId: 'owner_v1',
      conversationId: 'conversation_test',
      messageId: 'message_owner_2',
    });
    assert.equal(repeated.task.id, second.task.id);
    assert.equal(test.evaluations(), 2);
    assert.equal(
      (
        await test.resources.findConversationById(
          'owner_v1',
          'conversation_test',
        )
      )?.messages.length,
      4,
    );
  });

  void it('recovers a durable pending reply after conversation projection fails', async () => {
    const resources = new FailOnceReplyResourceStore();
    const test = harness({
      decision: responseDecision('Recovered reply.'),
      resources,
    });
    await resources.createConversation({
      schemaVersion: 1,
      id: 'conversation_recovery',
      principalId: 'owner_v1',
      creationKey: 'conversation-recovery',
      title: 'Recovery',
      status: 'active',
      messages: [
        {
          id: 'message_recovery_owner',
          requestKey: 'recovery-owner',
          role: 'owner',
          content: 'Recover this reply.',
          projectId: 'project_test',
          createdAt: '2026-08-24T18:00:00.000Z',
        },
      ],
      createdAt: '2026-08-24T18:00:00.000Z',
      updatedAt: '2026-08-24T18:00:00.000Z',
    });

    await assert.rejects(
      test.lifecycle.submit({
        message: 'Recover this reply.',
        requestKey: 'message_recovery_owner',
        principalId: 'owner_v1',
        conversationId: 'conversation_recovery',
        messageId: 'message_recovery_owner',
      }),
      /Synthetic reply projection failure/u,
    );
    const dispatchable = await test.store.findDispatchable(10);
    assert.equal(dispatchable.length, 1);
    const pendingReply = dispatchable[0];
    assert.ok(pendingReply);
    assert.equal(pendingReply.run.status, 'succeeded');
    assert.equal(pendingReply.run.conversationReply?.status, 'pending');

    const recovered = await test.lifecycle.progressTask(
      'owner_v1',
      pendingReply.task.id,
    );
    assert.equal(recovered.run.conversationReply?.status, 'projected');
    const conversation = await resources.findConversationById(
      'owner_v1',
      'conversation_recovery',
    );
    assert.deepEqual(
      conversation?.messages.map(({ role, content }) => ({ role, content })),
      [
        { role: 'owner', content: 'Recover this reply.' },
        { role: 'vera', content: 'Recovered reply.' },
      ],
    );
  });

  void it('upgrades a legacy terminal conversation run using a role-scoped reply key', async () => {
    const test = harness({ executionMode: 'worker' });
    await test.resources.createConversation({
      schemaVersion: 1,
      id: 'conversation_legacy',
      principalId: 'owner_v1',
      creationKey: 'conversation-legacy',
      title: 'Legacy conversation',
      status: 'active',
      messages: [
        {
          id: 'message_legacy_owner',
          requestKey: 'vera-reply:task_legacy',
          role: 'owner',
          content: 'Legacy request.',
          projectId: 'project_test',
          taskId: 'task_legacy',
          createdAt: '2026-08-24T18:00:00.000Z',
        },
      ],
      createdAt: '2026-08-24T18:00:00.000Z',
      updatedAt: '2026-08-24T18:00:00.000Z',
    });
    await test.store.create({
      schemaVersion: 1,
      version: 1,
      task: {
        id: 'task_legacy',
        requestKey: 'legacy-task',
        principalId: 'owner_v1',
        conversationId: 'conversation_legacy',
        messageId: 'message_legacy_owner',
        projectId: 'project_test',
        message: 'Legacy request.',
        status: 'completed',
        createdAt: '2026-08-24T18:00:00.000Z',
        updatedAt: '2026-08-24T18:00:01.000Z',
      },
      run: {
        id: 'run_legacy',
        status: 'succeeded',
        createdAt: '2026-08-24T18:00:00.000Z',
        updatedAt: '2026-08-24T18:00:01.000Z',
        output: { kind: 'response', message: 'Legacy reply.' },
      },
      events: [
        {
          schemaVersion: 1,
          id: 'event_legacy',
          sequence: 1,
          type: 'run_succeeded',
          occurredAt: '2026-08-24T18:00:01.000Z',
          data: {},
        },
      ],
    });

    assert.equal((await test.store.findDispatchable(10)).length, 1);
    await test.lifecycle.recoverInterrupted();

    const upgraded = await test.lifecycle.getRun('owner_v1', 'run_legacy');
    assert.equal(upgraded.run.conversationReply?.status, 'projected');
    assert.deepEqual(
      upgraded.events.slice(-2).map((event) => event.type),
      ['conversation_reply_pending', 'conversation_reply_projected'],
    );
    const conversation = await test.resources.findConversationById(
      'owner_v1',
      'conversation_legacy',
    );
    assert.deepEqual(
      conversation?.messages.map(({ role, requestKey, content }) => ({
        role,
        requestKey,
        content,
      })),
      [
        {
          role: 'owner',
          requestKey: 'vera-reply:task_legacy',
          content: 'Legacy request.',
        },
        {
          role: 'vera',
          requestKey: 'vera-reply:task_legacy',
          content: 'Legacy reply.',
        },
      ],
    );
  });

  void it('fails closed before model invocation when frozen conversation context is tampered', async () => {
    const test = harness({ executionMode: 'worker' });
    await test.resources.createConversation({
      schemaVersion: 1,
      id: 'conversation_tampered',
      principalId: 'owner_v1',
      creationKey: 'conversation-tampered',
      title: 'Tampered context',
      status: 'active',
      messages: [
        {
          id: 'message_prior_owner',
          requestKey: 'prior-owner',
          role: 'owner',
          content: 'Prior request.',
          projectId: 'project_test',
          taskId: 'task_prior',
          createdAt: '2026-08-24T18:00:00.000Z',
        },
        {
          id: 'message_prior_vera',
          requestKey: 'prior-vera',
          role: 'vera',
          content: 'Prior reply.',
          projectId: 'project_test',
          taskId: 'task_prior',
          createdAt: '2026-08-24T18:00:01.000Z',
        },
        {
          id: 'message_current_owner',
          requestKey: 'current-owner',
          role: 'owner',
          content: 'Current request.',
          projectId: 'project_test',
          createdAt: '2026-08-24T18:00:02.000Z',
        },
      ],
      createdAt: '2026-08-24T18:00:00.000Z',
      updatedAt: '2026-08-24T18:00:02.000Z',
    });
    const submitted = await test.lifecycle.submit({
      message: 'Current request.',
      requestKey: 'tampered-task',
      principalId: 'owner_v1',
      conversationId: 'conversation_tampered',
      messageId: 'message_current_owner',
    });
    const tampered = structuredClone(submitted);
    assert.ok(tampered.run.conversationContext?.messages[0]);
    tampered.run.conversationContext.messages[0].content = 'Altered request.';
    tampered.version += 1;
    assert.equal(await test.store.replace(tampered, submitted.version), true);

    const failed = await test.lifecycle.progressTask(
      'owner_v1',
      submitted.task.id,
    );
    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.failure?.code, 'conversation_context_failure');
    assert.equal(test.evaluations(), 0);
  });

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

  void it('persists an approved software change as a review-only artifact', async () => {
    const test = harness({ decision: softwareChangeDecision() });
    const pending = await test.lifecycle.submit({
      message: 'implement request tracing',
      requestKey: 'request-change-1',
      principalId: 'owner_v1',
    });

    assert.equal(pending.run.status, 'awaiting_approval');
    const approval = pending.run.approval;
    assert.ok(approval);
    assert.equal(approval.capability.name, 'software_change');
    assert.equal(approval.destination?.adapterId, 'deterministic_change');

    const completed = await test.lifecycle.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      principalId: 'owner_v1',
    });

    assert.equal(completed.run.status, 'succeeded');
    if (completed.run.output?.kind !== 'software_change') {
      assert.fail('Expected a software-change output.');
    }
    assert.equal(completed.run.output.change.project.id, 'project_test');
    assert.equal(completed.run.output.change.project.revision, 'test-revision');
    assert.equal(completed.run.output.change.files.length, 1);
    assert.match(completed.run.output.change.patch, /new file mode 100644/u);
    assert.equal(completed.run.output.artifact?.type, 'software_change');
    const artifactId = completed.run.output.artifact.id;
    const artifact = await test.resources.findArtifactById(
      'owner_v1',
      artifactId,
    );
    assert.equal(artifact?.type, 'software_change');
    assert.equal(artifact.content.objective, 'Implement request tracing.');
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

  void it('fails closed when resolved adapter authority changes after approval', async () => {
    const approvedCapability = new FakePlanningCapability();
    const baseCapabilities = createTestCapabilityRuntime({
      developmentPlanning: registryFor(approvedCapability),
      softwareChange: createDeterministicSoftwareChangeRegistry(),
    });
    let authorityChanged = false;
    const capabilities: CapabilityRuntimeRegistry = {
      ...baseCapabilities,
      resolve(reference, destination) {
        const runtime = baseCapabilities.resolve(reference, destination);
        if (runtime === null || !authorityChanged) return runtime;
        return {
          ...runtime,
          authority: {
            ...runtime.authority,
            networkAccess: 'provider_api',
            sideEffects: ['third_party_disclosure'],
            credentials: 'server_managed',
          },
        };
      },
    };
    const test = harness({
      decision: planningDecision(),
      capability: approvedCapability,
      capabilities,
    });
    const pending = await test.lifecycle.submit({
      message: 'plan request tracing',
      requestKey: 'request-approved-authority-drift',
      principalId: 'owner_v1',
    });
    const approval = pending.run.approval;
    assert.ok(approval);
    authorityChanged = true;

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
    interrupted.run.invocation = CapabilityInvocationSchema.parse({
      id: 'invocation_recovery_test',
      status: 'executing',
      capability: approval.capability,
      arguments: approval.proposedArguments,
      project: approval.project,
      contextManifest: context.manifest,
      startedAt: '2026-08-24T18:00:00.000Z',
    });
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
    interrupted.run.invocation = CapabilityInvocationSchema.parse({
      id: 'invocation_cancel_recovery_test',
      status: 'executing',
      capability: approval.capability,
      arguments: approval.proposedArguments,
      project: approval.project,
      contextManifest: context.manifest,
      startedAt: '2026-08-24T18:00:00.000Z',
    });
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
