import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRoutineStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-routine-store.ts';
import { createRoutineLifecycle } from '../../../src/application/routines/routine-lifecycle.ts';
import { nextRoutineOccurrence } from '../../../src/application/routines/routine-schedule.ts';
import type { MachineOperations } from '../../../src/ports/machines/machine-operations.ts';
import type { ExternalAwarenessOperations } from '../../../src/ports/external-awareness/external-awareness-operations.ts';

const catalog = {
  schemaVersion: 1 as const,
  machines: [
    {
      id: 'macmini',
      displayName: 'Mac Mini',
      adapter: { kind: 'local' as const },
      diagnostics: [],
      services: [
        {
          id: 'vera_api',
          displayName: 'Vera API',
          probe: {
            kind: 'http' as const,
            url: 'http://127.0.0.1:4310/health',
            healthyStatuses: [200],
            timeoutMs: 1_000,
          },
          actions: {},
        },
      ],
    },
  ],
};

function machines(
  status: 'healthy' | 'unhealthy' = 'healthy',
): MachineOperations {
  return {
    catalog,
    destinationFor: () => ({
      schemaVersion: 1,
      adapterId: 'test',
      provider: 'test',
      transport: 'local_process',
      dataBoundary: 'owner_controlled',
    }),
    resolve: () => 'macmini',
    checkReadiness: () => Promise.resolve(),
    inspect: () =>
      Promise.resolve({
        schemaVersion: 1,
        machine: { id: 'macmini', displayName: 'Mac Mini' },
        adapter: 'local',
        inspectedAt: '2026-09-04T06:00:00.000Z',
        system: {
          hostname: 'macmini',
          platform: 'darwin',
          architecture: 'arm64',
        },
        diagnostics: [],
        services: [
          {
            id: 'vera_api',
            displayName: 'Vera API',
            observation: {
              status,
              checkedAt: '2026-09-04T06:00:00.000Z',
              durationMs: 3,
              summary: status,
            },
          },
        ],
      }),
    manageService: () => {
      throw new Error('Routine must never control services.');
    },
  };
}

void describe('routine lifecycle', () => {
  void it('requires exact approval, materializes one occurrence, and stays quiet when healthy', async () => {
    const store = new InMemoryRoutineStore();
    let now = new Date('2026-09-04T05:00:00.000Z');
    const lifecycle = createRoutineLifecycle({
      store,
      machines: machines(),
      clock: () => now,
      createId: (() => {
        let id = 0;
        return (prefix) => `${prefix}_test_${String(++id)}`;
      })(),
    });
    const created = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'routine-test-create',
      title: 'Morning health',
      schedule: {
        kind: 'daily',
        timeZone: 'Africa/Johannesburg',
        localTime: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      action: {
        kind: 'machine_health_check',
        machineId: 'macmini',
        serviceIds: ['vera_api'],
      },
    });
    assert.equal(created.status, 'awaiting_approval');
    assert.equal(created.nextRunAt, undefined);
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    assert.equal(approved.nextRunAt, '2026-09-04T06:00:00.000Z');
    assert.equal(
      (
        await lifecycle.decideApproval({
          principalId: 'owner_v1',
          routineId: created.id,
          decision: 'approved',
        })
      ).version,
      approved.version,
    );
    now = new Date('2026-09-04T06:00:01.000Z');
    const first = await lifecycle.materializeDue(approved);
    const replay = await store.createRun(first);
    assert.equal(replay.created, false);
    const completed = await lifecycle.executeRun('owner_v1', first.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result?.outcome, 'healthy');
    assert.equal((await store.listAttentionRuns('owner_v1', 10)).length, 0);
    const current = await lifecycle.get('owner_v1', created.id);
    assert.equal(current.nextRunAt, '2026-09-05T06:00:00.000Z');
  });

  void it('surfaces unhealthy results and preserves approved scope for manual runs', async () => {
    const store = new InMemoryRoutineStore();
    const lifecycle = createRoutineLifecycle({
      store,
      machines: machines('unhealthy'),
      clock: () => new Date('2026-09-04T05:00:00.000Z'),
    });
    const created = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'routine-unhealthy',
      title: 'Health',
      schedule: {
        kind: 'daily',
        timeZone: 'UTC',
        localTime: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      action: {
        kind: 'machine_health_check',
        machineId: 'macmini',
        serviceIds: ['vera_api'],
      },
    });
    await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    const run = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: created.id,
      requestKey: 'manual-one',
    });
    assert.equal(run.action.kind, 'machine_health_check');
    assert.deepEqual(run.action.serviceIds, ['vera_api']);
    const completed = await lifecycle.executeRun('owner_v1', run.id);
    assert.equal(completed.result?.outcome, 'attention_required');
    assert.equal(
      (await store.listAttentionRuns('owner_v1', 10))[0]?.id,
      run.id,
    );
    await lifecycle.pause('owner_v1', created.id);
    assert.equal(
      (
        await lifecycle.runNow({
          principalId: 'owner_v1',
          routineId: created.id,
          requestKey: 'manual-one',
        })
      ).id,
      completed.id,
    );
  });

  void it('resumes interval routines from now instead of replaying missed intervals', async () => {
    const store = new InMemoryRoutineStore();
    let now = new Date('2026-09-05T10:00:00.000Z');
    const lifecycle = createRoutineLifecycle({
      store,
      machines: machines(),
      clock: () => now,
    });
    const created = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'interval-resume',
      title: 'Interval health',
      schedule: { kind: 'interval', minutes: 15 },
      action: { kind: 'machine_health_check', machineId: 'macmini' },
    });
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    now = new Date('2026-09-05T10:15:00.000Z');
    await lifecycle.materializeDue(approved);
    now = new Date('2026-09-05T10:16:00.000Z');
    await lifecycle.pause('owner_v1', created.id);
    now = new Date('2026-09-05T15:00:00.000Z');
    const resumed = await lifecycle.resume('owner_v1', created.id);

    assert.equal(resumed.nextRunAt, '2026-09-05T15:15:00.000Z');
  });

  void it('replays an external-watch idempotency key without re-freezing external scope', async () => {
    let freezeCalls = 0;
    const externalAwareness: ExternalAwarenessOperations = {
      get: () => Promise.reject(new Error('Not used by routine lifecycle.')),
      list: () => Promise.resolve([]),
      listByRoutine: () => Promise.resolve([]),
      freeze: (input) => {
        freezeCalls += 1;
        if (freezeCalls > 1) throw new Error('External scope was re-frozen.');
        return Promise.resolve({
          kind: 'integration_awareness',
          integrationId: 'github',
          connectionId: 'connection_test',
          account: { providerAccountId: '123', login: 'owner' },
          project: { id: input.projectId, displayName: 'Vera' },
          repository: { provider: 'github', owner: 'owner', name: 'vera' },
          categories: input.categories,
        });
      },
      execute: () =>
        Promise.resolve({
          observations: [],
          created: 0,
          changed: 0,
          resolved: 0,
        }),
    };
    const lifecycle = createRoutineLifecycle({
      store: new InMemoryRoutineStore(),
      machines: machines(),
      externalAwareness,
    });
    const request = {
      principalId: 'owner_v1',
      requestKey: 'github-watch-replay',
      title: 'Watch GitHub',
      schedule: { kind: 'interval' as const, minutes: 15 },
      action: {
        kind: 'integration_awareness' as const,
        integrationId: 'github' as const,
        projectId: 'project_vera',
        categories: ['failed_check', 'review_requested'] as (
          | 'review_requested'
          | 'mentioned'
          | 'assigned'
          | 'failed_check'
        )[],
      },
    };
    const created = await lifecycle.create(request);
    const replay = await lifecycle.create(request);
    assert.equal(replay.id, created.id);
    assert.equal(freezeCalls, 1);
  });

  void it('does not execute a repeated local clock hour twice across DST', () => {
    const schedule = {
      kind: 'daily' as const,
      timeZone: 'America/New_York',
      localTime: '01:30',
      daysOfWeek: [0],
    };
    const first = nextRoutineOccurrence(
      schedule,
      new Date('2026-11-01T04:00:00.000Z'),
    );
    assert.equal(first, '2026-11-01T05:30:00.000Z');
    assert.equal(
      nextRoutineOccurrence(schedule, new Date(first), first),
      '2026-11-08T06:30:00.000Z',
    );
  });

  void it('advances interval schedules from the prior occurrence without drift', () => {
    assert.equal(
      nextRoutineOccurrence(
        { kind: 'interval', minutes: 15 },
        new Date('2026-09-05T10:07:00.000Z'),
      ),
      '2026-09-05T10:22:00.000Z',
    );
    assert.equal(
      nextRoutineOccurrence(
        { kind: 'interval', minutes: 15 },
        new Date('2026-09-05T10:22:09.000Z'),
        '2026-09-05T10:22:00.000Z',
      ),
      '2026-09-05T10:37:00.000Z',
    );
  });

  void it('skips a nonexistent daylight-saving local time without shifting it', () => {
    const next = nextRoutineOccurrence(
      {
        kind: 'daily',
        timeZone: 'America/New_York',
        localTime: '02:30',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      new Date('2026-03-08T05:00:00.000Z'),
    );

    assert.equal(next, '2026-03-09T06:30:00.000Z');
  });
});
