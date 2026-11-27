import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../../../../src/adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import { InMemoryOwnerResourceStore } from '../../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { InMemoryScratchpad } from '../../../../src/adapters/outbound/persistence/memory/in-memory-scratchpad.ts';
import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import { createConversationService } from '../../../../src/application/conversations/conversation-service.ts';
import { createTaskLifecycle } from '../../../../src/application/tasks/task-lifecycle.ts';
import type { DecisionResult } from '../../../../src/domain/model/execution-decision.ts';
import type { DevelopmentPlan } from '../../../../src/domain/plans/development-plan.ts';
import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { TaskLifecycleResponseJsonSchema } from '../../../../src/adapters/inbound/http/schemas.ts';
import type { DevelopmentPlanningCapability } from '../../../../src/ports/capabilities/development-planning-capability.ts';
import type { CapabilityRuntimeRegistry } from '../../../../src/ports/capabilities/capability-runtime.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';
import { createDeterministicSoftwareChangeRegistry } from '../../../support/deterministic-software-change-registry.ts';
import { createTestCapabilityRuntime } from '../../../support/test-capability-runtime.ts';

const apps: ReturnType<typeof buildApp>[] = [];

const emptyCapabilities: CapabilityRuntimeRegistry = {
  declarations: () => [],
  enabledReferences: () => [],
  selected: () => null,
  resolve: () => null,
};

function createHarness() {
  const resources = new InMemoryOwnerResourceStore();
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
  const provider = new FakeModelProvider({
    schemaVersion: 1,
    kind: 'invoke_capability',
    decisionSummary: 'A planning specialist is required.',
    capability: { name: 'development_planning', version: 1 },
    arguments: {
      objective: 'Add request tracing.',
      ticket: { reference: 'VERA-202', details: 'Trace API requests.' },
      project: { name: 'Vera' },
    },
  });
  const plan: DevelopmentPlan = {
    schemaVersion: 1,
    project: {
      name: 'Vera',
      id: 'project_test',
      revision: 'test-revision',
    },
    ticket: { reference: 'VERA-202', details: 'Trace API requests.' },
    objective: 'Add request tracing.',
    title: 'Request tracing plan',
    summary: 'Add correlation across Vera requests.',
    scope: ['Propagate a request identifier through the API.'],
    nonGoals: [],
    assumptions: [],
    unresolvedQuestions: [],
    affectedProjectAreas: [],
    phases: [
      {
        name: 'Implementation',
        objective: 'Propagate request identifiers.',
        steps: ['Create and propagate a request identifier.'],
        verification: ['Verify the identifier in logs and events.'],
      },
    ],
    risks: [],
  };
  const capability: DevelopmentPlanningCapability = {
    destination: {
      schemaVersion: 1,
      adapterId: 'test_planner',
      provider: 'fake',
      transport: 'in_process',
      dataBoundary: 'owner_controlled',
    },
    checkReadiness: () => Promise.resolve(),
    execute: () =>
      Promise.resolve({
        plan,
        model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
      }),
  };
  const lifecycle = createTaskLifecycle({
    store: new InMemoryExecutionStore(),
    scratchpad: new InMemoryScratchpad(),
    evaluateModelDecision: createEvaluateModelDecision(provider),
    capabilities: createTestCapabilityRuntime({
      developmentPlanning: {
        selected: () => capability,
        resolve: () => capability,
      },
      softwareChange: createDeterministicSoftwareChangeRegistry(),
    }),
    resources,
    contextAssembler: {
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
            exclusions: ['Synthetic HTTP test context.'],
          },
          documents: [],
        }),
    },
  });
  const conversations = createConversationService({ store: resources });
  const app = buildApp({
    provider,
    evaluateModelDecision: createEvaluateModelDecision(provider),
    taskLifecycle: lifecycle,
    conversations,
  });
  apps.push(app);
  return app;
}

function createClarificationHarness() {
  const provider = new FakeModelProvider({
    schemaVersion: 1,
    kind: 'respond',
    decisionSummary: 'Unused HTTP evaluator.',
    message: 'unused',
  });
  const decisions: DecisionResult[] = [
    {
      decisionId: 'decision_question',
      proposal: {
        schemaVersion: 1,
        kind: 'request_clarification',
        decisionSummary: 'The destination is unresolved.',
        question: 'Where should I send it?',
        missingInformation: [
          { key: 'destination', description: 'Need the destination.' },
        ],
        resolvedFacts: [],
      },
      decision: {
        kind: 'clarification_required',
        question: 'Where should I send it?',
        missingInformation: [
          { key: 'destination', description: 'Need the destination.' },
        ],
        resolvedFacts: [],
      },
      model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
    },
    {
      decisionId: 'decision_answer',
      proposal: {
        schemaVersion: 1,
        kind: 'respond',
        decisionSummary: 'The request is now clear.',
        message: 'I will send it to Sam.',
      },
      decision: { kind: 'respond', message: 'I will send it to Sam.' },
      model: { provider: 'fake', model: 'fake-v1', durationMs: 1 },
    },
  ];
  const resources = new InMemoryOwnerResourceStore();
  const lifecycle = createTaskLifecycle({
    store: new InMemoryExecutionStore(),
    scratchpad: new InMemoryScratchpad(),
    evaluateModelDecision: () => {
      const decision = decisions.shift();
      if (decision === undefined) throw new Error('Unexpected evaluation.');
      return Promise.resolve(decision);
    },
    capabilities: emptyCapabilities,
    resources,
    contextAssembler: {
      assemble: () => Promise.reject(new Error('Unexpected project context.')),
    },
  });
  const conversations = createConversationService({ store: resources });
  const app = buildApp({
    provider,
    evaluateModelDecision: createEvaluateModelDecision(provider),
    taskLifecycle: lifecycle,
    conversations,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('task lifecycle HTTP API', () => {
  void it('publishes fixed and adaptive goal response contracts', () => {
    const schema = JSON.stringify(TaskLifecycleResponseJsonSchema);
    assert.match(schema, /"const":1/u);
    assert.match(schema, /"const":2/u);
    assert.match(schema, /"const":"adaptive"/u);
    assert.match(schema, /"continuations"/u);
  });

  void it('requires an idempotency key when submitting work', async () => {
    const response = await createHarness().inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: { message: 'Plan request tracing.', projectId: 'project_test' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ error: { code: string } }>().error.code,
      'invalid_request',
    );
  });

  void it('rejects extra task request properties', async () => {
    const response = await createHarness().inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'task-http-extra' },
      payload: {
        message: 'Plan request tracing.',
        projectId: 'project_test',
        authorized: true,
      },
    });

    assert.equal(response.statusCode, 400);
  });

  void it('answers a clarification and resumes the same task', async () => {
    const app = createClarificationHarness();
    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'clarification-http-submit' },
      payload: { message: 'Send it.' },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const pending = submitted.json<{
      taskId: string;
      runId: string;
      runStatus: string;
      clarification: { rounds: { question: string }[] };
      links: { clarificationAnswer: string };
    }>();
    assert.equal(pending.runStatus, 'awaiting_clarification');
    assert.equal(
      pending.clarification.rounds[0]?.question,
      'Where should I send it?',
    );
    assert.equal(
      pending.links.clarificationAnswer,
      `/v1/tasks/${pending.taskId}/clarification-answers`,
    );

    const answered = await app.inject({
      method: 'POST',
      url: pending.links.clarificationAnswer,
      headers: { 'idempotency-key': 'clarification-http-answer' },
      payload: { content: 'Send it to Sam.' },
    });
    assert.equal(answered.statusCode, 202, answered.body);
    const completed = answered.json<{
      taskId: string;
      runId: string;
      runStatus: string;
      output: { kind: string; message: string };
      clarification: { status: string };
    }>();
    assert.equal(completed.taskId, pending.taskId);
    assert.equal(completed.runId, pending.runId);
    assert.equal(completed.runStatus, 'succeeded');
    assert.equal(completed.output.message, 'I will send it to Sam.');
    assert.equal(completed.clarification.status, 'resolved');

    const replay = await app.inject({
      method: 'POST',
      url: pending.links.clarificationAnswer,
      headers: { 'idempotency-key': 'clarification-http-answer' },
      payload: { content: 'Send it to Sam.' },
    });
    assert.equal(replay.statusCode, 202, replay.body);
    assert.equal(replay.json<{ taskId: string }>().taskId, pending.taskId);

    const conflictingReplay = await app.inject({
      method: 'POST',
      url: pending.links.clarificationAnswer,
      headers: { 'idempotency-key': 'clarification-http-answer' },
      payload: { content: 'Send it somewhere else.' },
    });
    assert.equal(conflictingReplay.statusCode, 409, conflictingReplay.body);
    assert.equal(
      conflictingReplay.json<{ error: { code: string } }>().error.code,
      'idempotency_key_reused',
    );
  });

  void it('uses one conversation message sequence for an idempotent clarification loop', async () => {
    const app = createClarificationHarness();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'clarification-conversation' },
      payload: { title: 'Clarification test' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ id: string }>().id;
    const asked = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'clarification-conversation-question' },
      payload: { content: 'Send it.' },
    });
    assert.equal(asked.statusCode, 202, asked.body);
    const pending = asked.json<{ taskId: string; runStatus: string }>();
    assert.equal(pending.runStatus, 'awaiting_clarification');

    const answerRequest = {
      method: 'POST' as const,
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'clarification-conversation-answer' },
      payload: {
        content: 'Send it to Sam.',
        clarificationTaskId: pending.taskId,
      },
    };
    const answered = await app.inject(answerRequest);
    assert.equal(answered.statusCode, 202, answered.body);
    assert.equal(
      answered.json<{ taskId: string; runStatus: string }>().taskId,
      pending.taskId,
    );
    assert.equal(answered.json<{ runStatus: string }>().runStatus, 'succeeded');

    const replay = await app.inject(answerRequest);
    assert.equal(replay.statusCode, 202, replay.body);
    assert.equal(replay.json<{ taskId: string }>().taskId, pending.taskId);
    const conversation = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    assert.equal(conversation.statusCode, 200, conversation.body);
    assert.deepEqual(
      conversation
        .json<{ messages: { role: string; taskId?: string }[] }>()
        .messages.map(({ role, taskId }) => ({ role, taskId })),
      [
        { role: 'owner', taskId: pending.taskId },
        { role: 'vera', taskId: pending.taskId },
        { role: 'owner', taskId: pending.taskId },
        { role: 'vera', taskId: pending.taskId },
      ],
    );
  });

  void it('submits, inspects, approves, executes, and audits a task end to end', async () => {
    const app = createHarness();
    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'task-http-e2e' },
      payload: { message: 'Plan request tracing.', projectId: 'project_test' },
    });

    assert.equal(submitted.statusCode, 202);
    const pending = submitted.json<{
      taskId: string;
      runId: string;
      runStatus: string;
      approval: { id: string; status: string };
    }>();
    assert.equal(pending.runStatus, 'awaiting_approval');
    assert.equal(pending.approval.status, 'pending');

    const inspected = await app.inject({
      method: 'GET',
      url: `/v1/runs/${pending.runId}`,
    });
    assert.equal(inspected.statusCode, 200, inspected.body);
    assert.equal(inspected.json<{ taskId: string }>().taskId, pending.taskId);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202);
    assert.equal(approved.json<{ runStatus: string }>().runStatus, 'succeeded');
    assert.equal(
      approved.json<{ output: { kind: string } }>().output.kind,
      'development_plan',
    );

    const events = await app.inject({
      method: 'GET',
      url: `/v1/runs/${pending.runId}/events`,
    });
    assert.equal(events.statusCode, 200, events.body);
    assert.deepEqual(
      events
        .json<{ events: { type: string }[] }>()
        .events.map((event) => event.type),
      [
        'task_created',
        'run_started',
        'budget_assigned',
        'budget_consumed',
        'model_decision_recorded',
        'context_assembled',
        'approval_requested',
        'approval_approved',
        'budget_consumed',
        'capability_invocation_started',
        'artifact_created',
        'capability_invocation_succeeded',
        'run_succeeded',
      ],
    );
  });
});
