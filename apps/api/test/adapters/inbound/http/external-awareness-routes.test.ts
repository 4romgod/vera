import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import { RoutineError } from '../../../../src/application/routines/routine-lifecycle.ts';
import { ExternalSignalSchema } from '../../../../src/domain/external-awareness/external-signal.ts';
import type { ExternalAwarenessOperations } from '../../../../src/ports/external-awareness/external-awareness-operations.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';

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
});
