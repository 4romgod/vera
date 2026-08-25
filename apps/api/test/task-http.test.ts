import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../src/adapters/in-memory-execution-store.ts';
import { InMemoryResourceStore } from '../src/adapters/in-memory-resource-store.ts';
import { InMemoryScratchpad } from '../src/adapters/in-memory-scratchpad.ts';
import { createEvaluateModelDecision } from '../src/application/evaluate-model-decision.ts';
import { createTaskLifecycle } from '../src/application/task-lifecycle.ts';
import type { DevelopmentPlan } from '../src/domain/development-plan.ts';
import { buildApp } from '../src/http/build-app.ts';
import type { DevelopmentPlanningCapability } from '../src/ports/development-planning-capability.ts';
import { FakeModelProvider } from './support/fake-model-provider.ts';

const apps: ReturnType<typeof buildApp>[] = [];

function createHarness() {
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
    developmentPlanning: {
      selected: () => capability,
      resolve: () => capability,
    },
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
  const app = buildApp({
    provider,
    evaluateModelDecision: createEvaluateModelDecision(provider),
    taskLifecycle: lifecycle,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('task lifecycle HTTP API', () => {
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
