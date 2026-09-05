import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import { RoutineError } from '../../../../src/application/routines/routine-lifecycle.ts';
import { ExternalSignalSchema } from '../../../../src/domain/external-awareness/external-signal.ts';
import type { ExternalAwarenessOperations } from '../../../../src/ports/external-awareness/external-awareness-operations.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';
import type { TaskAggregate } from '../../../../src/domain/tasks/task-aggregate.ts';
import { ExternalSignalResolutionSchema } from '../../../../src/domain/external-awareness/external-signal-resolution.ts';

const apps: ReturnType<typeof buildApp>[] = [];
const signal = ExternalSignalSchema.parse({
  schemaVersion: 1,
  version: 1,
  id: 'external_signal_http_test',
  principalId: 'owner_v1',
  routineId: 'routine_http_test',
  integrationId: 'github',
  connectionId: 'connection_http_test',
  project: { id: 'project_http_test', displayName: 'Vera' },
  repository: { provider: 'github', owner: '4romgod', name: 'vera' },
  externalKey: 'pull:42:failed-checks',
  category: 'failed_check',
  title: 'Checks failed on #42',
  summary: 'quality-gate failed.',
  url: 'https://github.com/4romgod/vera/pull/42',
  occurredAt: '2026-09-05T10:00:00.000Z',
  status: 'active',
  firstObservedAt: '2026-09-05T10:01:00.000Z',
  lastObservedAt: '2026-09-05T10:01:00.000Z',
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('external awareness HTTP API', () => {
  void it('lists active and routine-scoped signals and rejects an unknown routine', async () => {
    const awareness: ExternalAwarenessOperations = {
      get: () => Promise.resolve(signal),
      list: () => Promise.resolve([signal]),
      listByRoutine: () => Promise.resolve([signal]),
      freeze: () => Promise.reject(new Error('Not used by list routes.')),
      execute: () => Promise.reject(new Error('Not used by list routes.')),
    };
    const provider = new FakeModelProvider({});
    const app = buildApp({
      provider,
      evaluateModelDecision: createEvaluateModelDecision(provider),
      externalAwareness: awareness,
      routines: {
        get: (_principalId: string, routineId: string) =>
          routineId === signal.routineId
            ? Promise.resolve({} as never)
            : Promise.reject(
                new RoutineError(
                  `Routine ${routineId} was not found.`,
                  'routine_not_found',
                ),
              ),
      } as never,
    });
    apps.push(app);

    const active = await app.inject({
      method: 'GET',
      url: '/v1/external-signals',
    });
    assert.equal(active.statusCode, 200, active.body);
    assert.equal(
      active.json<{ signals: { id: string }[] }>().signals[0]?.id,
      signal.id,
    );

    const scoped = await app.inject({
      method: 'GET',
      url: `/v1/routines/${signal.routineId}/external-signals`,
    });
    assert.equal(scoped.statusCode, 200, scoped.body);
    assert.equal(scoped.json<{ signals: unknown[] }>().signals.length, 1);

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/routines/routine_missing/external-signals',
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(
      missing.json<{ error: { code: string } }>().error.code,
      'routine_not_found',
    );
  });

  void it('starts signal triage through an idempotent task boundary', async () => {
    const awareness: ExternalAwarenessOperations = {
      get: () => Promise.resolve(signal),
      list: () => Promise.resolve([signal]),
      listByRoutine: () => Promise.resolve([signal]),
      freeze: () => Promise.reject(new Error('Not used by triage route.')),
      execute: () => Promise.reject(new Error('Not used by triage route.')),
    };
    const aggregate = {
      schemaVersion: 1,
      version: 1,
      task: {
        id: 'task_signal_http',
        requestKey: 'message_signal_http',
        principalId: 'owner_v1',
        conversationId: 'conversation_signal_http',
        messageId: 'message_signal_http',
        projectId: signal.project.id,
        externalSignal: { id: signal.id, version: signal.version },
        message: 'Investigate this signal.',
        status: 'active',
        createdAt: '2026-09-05T10:02:00.000Z',
        updatedAt: '2026-09-05T10:02:00.000Z',
      },
      run: {
        id: 'run_signal_http',
        status: 'deciding',
        createdAt: '2026-09-05T10:02:00.000Z',
        updatedAt: '2026-09-05T10:02:00.000Z',
      },
      events: [],
    } as TaskAggregate;
    let received: Record<string, unknown> | undefined;
    const provider = new FakeModelProvider({});
    const app = buildApp({
      provider,
      evaluateModelDecision: createEvaluateModelDecision(provider),
      externalAwareness: awareness,
      externalSignalTriage: {
        handle: (input) => {
          received = input;
          return Promise.resolve(aggregate);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/external-signals/${signal.id}/triage`,
      headers: { 'idempotency-key': 'phone-tap' },
      payload: { objective: 'Please investigate this failure.' },
    });

    assert.equal(response.statusCode, 202, response.body);
    assert.equal(response.headers.location, '/v1/tasks/task_signal_http');
    assert.deepEqual(received, {
      principalId: 'owner_v1',
      signalId: signal.id,
      requestKey: 'phone-tap',
      objective: 'Please investigate this failure.',
    });
    const body = response.json<{
      externalSignal: { id: string; version: number };
    }>();
    assert.deepEqual(body.externalSignal, {
      id: signal.id,
      version: signal.version,
    });
  });

  void it('returns the derived resolution path for an observed signal', async () => {
    const provider = new FakeModelProvider({});
    const resolution = ExternalSignalResolutionSchema.parse({
      schemaVersion: 1,
      signal,
      progress: {
        status: 'untriaged',
        summary: 'This signal has not been triaged by Vera yet.',
        updatedAt: signal.lastObservedAt,
      },
      links: {
        signal: `/v1/external-signals/${signal.id}`,
        source: signal.url,
      },
    });
    const app = buildApp({
      provider,
      evaluateModelDecision: createEvaluateModelDecision(provider),
      externalAwareness: {
        get: () => Promise.resolve(signal),
      } as unknown as ExternalAwarenessOperations,
      externalSignalResolution: {
        get: () => Promise.resolve(resolution),
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/external-signals/${signal.id}/resolution`,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      response.json<{ progress: { status: string } }>().progress.status,
      'untriaged',
    );
  });
});
