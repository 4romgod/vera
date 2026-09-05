import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExternalSignalStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-external-signal-store.ts';
import { InMemoryIntegrationConnectionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-integration-connection-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { InMemoryRoutineStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-routine-store.ts';
import { createExternalAwarenessService } from '../../../src/application/external-awareness/external-awareness-service.ts';
import { createIntegrationConnectionService } from '../../../src/application/integrations/integration-connection-service.ts';
import { createRoutineLifecycle } from '../../../src/application/routines/routine-lifecycle.ts';
import { GitHubIntegrationDefinition } from '../../../src/domain/integrations/integration-connection.ts';
import { ProjectSchema } from '../../../src/domain/projects/project.ts';
import type { ExternalSignalObservation } from '../../../src/domain/external-awareness/external-signal.ts';
import type { MachineOperations } from '../../../src/ports/machines/machine-operations.ts';

const machines: MachineOperations = {
  catalog: { schemaVersion: 1, machines: [] },
  destinationFor: () => {
    throw new Error('No machine is configured.');
  },
  resolve: () => null,
  checkReadiness: () => Promise.resolve(),
  inspect: () => Promise.reject(new Error('No machine is configured.')),
  manageService: () => Promise.reject(new Error('No machine is configured.')),
};

void describe('external awareness standing routine', () => {
  void it('freezes exact read authority, deduplicates signals, resolves absence, and fails on account drift', async () => {
    const resources = new InMemoryOwnerResourceStore();
    await resources.createProject(
      ProjectSchema.parse({
        schemaVersion: 1,
        id: 'project_vera',
        principalId: 'owner_v1',
        registrationKey: 'vera',
        displayName: 'Vera',
        normalizedName: 'vera',
        source: { kind: 'local_git', rootPath: '/projects/vera' },
        status: 'active',
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      }),
    );
    let account = { providerAccountId: '123', login: 'owner' };
    const connections = createIntegrationConnectionService({
      store: new InMemoryIntegrationConnectionStore(),
      connectors: [
        {
          adapterId: 'github_gh_cli',
          definition: GitHubIntegrationDefinition,
          credentialBinding: { kind: 'host_session', host: 'github.com' },
          inspectAccount: () => Promise.resolve(account),
        },
      ],
    });
    await connections.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'connect',
    });
    const signalStore = new InMemoryExternalSignalStore();
    let observations: ExternalSignalObservation[] = [
      {
        externalKey: 'pull:42:failed-checks',
        category: 'failed_check',
        title: 'Checks failed on #42',
        summary: 'quality-gate failed.',
        url: 'https://github.com/4romgod/vera/pull/42',
        occurredAt: '2026-09-05T01:00:00.000Z',
      },
    ];
    let observeCalls = 0;
    const awareness = createExternalAwarenessService({
      projects: resources,
      connections,
      signals: signalStore,
      sources: [
        {
          integrationId: 'github',
          observe: () => {
            observeCalls += 1;
            return Promise.resolve({ observations, complete: true });
          },
          checkReadiness: () => Promise.resolve(),
        },
      ],
      resolveRepository: () =>
        Promise.resolve({ provider: 'github', owner: '4romgod', name: 'vera' }),
    });
    let now = new Date('2026-09-05T00:00:00.000Z');
    const lifecycle = createRoutineLifecycle({
      store: new InMemoryRoutineStore(),
      machines,
      externalAwareness: awareness,
      clock: () => now,
    });
    const routine = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'watch-vera',
      title: 'Watch Vera on GitHub',
      schedule: { kind: 'interval', minutes: 15 },
      action: {
        kind: 'integration_awareness',
        integrationId: 'github',
        projectId: 'project_vera',
        categories: ['failed_check', 'review_requested'],
      },
    });
    assert.equal(routine.status, 'awaiting_approval');
    assert.equal(routine.approval.effect.action.kind, 'integration_awareness');
    assert.deepEqual(routine.approval.effect.authority, {
      recurringExecution: true,
      readExternalService: true,
      modifyExternalService: false,
      modifyRoutine: false,
    });
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: routine.id,
      decision: 'approved',
    });
    assert.equal(approved.nextRunAt, '2026-09-05T00:15:00.000Z');

    const first = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: routine.id,
      requestKey: 'first',
    });
    const completed = await lifecycle.executeRun('owner_v1', first.id);
    assert.deepEqual(completed.result, {
      kind: 'external_awareness',
      outcome: 'signals_observed',
      summary: '1 new or changed external signal needs attention.',
      observed: 1,
      created: 1,
      changed: 0,
      resolved: 0,
    });
    assert.equal((await awareness.list('owner_v1')).length, 1);

    now = new Date('2026-09-05T00:01:00.000Z');
    const second = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: routine.id,
      requestKey: 'second',
    });
    const unchanged = await lifecycle.executeRun('owner_v1', second.id);
    assert.equal(unchanged.result?.outcome, 'quiet');
    assert.equal((await awareness.list('owner_v1')).length, 1);

    observations = [];
    now = new Date('2026-09-05T00:02:00.000Z');
    const third = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: routine.id,
      requestKey: 'third',
    });
    const resolved = await lifecycle.executeRun('owner_v1', third.id);
    assert.equal(resolved.result?.kind, 'external_awareness');
    assert.equal(resolved.result.resolved, 1);
    assert.equal((await awareness.list('owner_v1')).length, 0);
    assert.equal(
      (await awareness.listByRoutine('owner_v1', routine.id))[0]?.status,
      'resolved',
    );

    observations = [
      {
        externalKey: 'pull:42:failed-checks',
        category: 'failed_check',
        title: 'Checks failed on #42',
        summary: 'quality-gate failed again.',
        url: 'https://github.com/4romgod/vera/pull/42',
        occurredAt: '2026-09-05T00:02:30.000Z',
      },
      {
        externalKey: 'unapproved-mention',
        category: 'mentioned',
        title: 'Mention outside approved categories',
        summary: 'This entire provider batch must fail closed.',
        url: 'https://github.com/4romgod/vera/issues/99',
        occurredAt: '2026-09-05T00:02:30.000Z',
      },
    ];
    now = new Date('2026-09-05T00:02:30.000Z');
    const invalidBatch = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: routine.id,
      requestKey: 'invalid-batch',
    });
    const invalidRun = await lifecycle.executeRun('owner_v1', invalidBatch.id);
    assert.equal(invalidRun.status, 'failed');
    assert.match(
      invalidRun.failure?.message ?? '',
      /outside the approved scope/u,
    );
    assert.equal((await awareness.list('owner_v1')).length, 0);

    const connection = (await connections.list('owner_v1'))[0];
    assert.ok(connection);
    await connections.revoke('owner_v1', connection.id);
    account = { providerAccountId: '999', login: 'other' };
    await connections.connect({
      principalId: 'owner_v1',
      integrationId: 'github',
      requestKey: 'reconnect-other',
    });
    now = new Date('2026-09-05T00:03:00.000Z');
    const drifted = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: routine.id,
      requestKey: 'drifted',
    });
    const failed = await lifecycle.executeRun('owner_v1', drifted.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.failure?.message ?? '', /identity has changed/u);
    assert.equal(observeCalls, 4);
  });
});
