import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRoutineStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-routine-store.ts';
import { InMemoryWorkLeaseStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-work-lease-store.ts';
import { createRoutineLifecycle } from '../../../src/application/routines/routine-lifecycle.ts';
import { createRoutineWorker } from '../../../src/application/routines/routine-worker.ts';
import type { MachineOperations } from '../../../src/ports/machines/machine-operations.ts';

const machines: MachineOperations = {
  catalog: {
    schemaVersion: 1,
    machines: [
      {
        id: 'macmini',
        displayName: 'Mac Mini',
        adapter: { kind: 'local' },
        diagnostics: [],
        services: [],
      },
    ],
  },
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
      inspectedAt: '2026-09-04T08:00:01.000Z',
      system: {
        hostname: 'macmini',
        platform: 'darwin',
        architecture: 'arm64',
      },
      diagnostics: [],
      services: [],
    }),
  manageService: () => {
    throw new Error('Routine must never control services.');
  },
};

void describe('routine worker', () => {
  void it('materializes and executes one due occurrence without duplicating it', async () => {
    const store = new InMemoryRoutineStore();
    let now = new Date('2026-09-04T07:59:00.000Z');
    const lifecycle = createRoutineLifecycle({
      store,
      machines,
      clock: () => now,
    });
    const routine = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'worker-routine',
      title: 'Daily health',
      schedule: {
        kind: 'daily',
        timeZone: 'UTC',
        localTime: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      action: { kind: 'machine_health_check', machineId: 'macmini' },
    });
    await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: routine.id,
      decision: 'approved',
    });
    const worker = createRoutineWorker({
      workerId: 'routine_worker_test',
      store,
      leases: new InMemoryWorkLeaseStore(),
      lifecycle,
      concurrency: 1,
      pollIntervalMs: 10,
      leaseMs: 1_000,
      clock: () => now,
      createToken: () => 'routine_worker_token',
    });

    assert.equal(await worker.runOnce(), 0);
    now = new Date('2026-09-04T08:00:00.000Z');
    assert.equal(await worker.runOnce(), 2);
    assert.equal(await worker.runOnce(), 0);
    const runs = await lifecycle.listRuns('owner_v1', routine.id);
    assert.equal(runs.length, 1);
    const run = runs[0];
    assert.ok(run);
    assert.equal(run.status, 'succeeded');
    assert.equal(run.result?.outcome, 'healthy');
  });

  void it('recovers a run left in executing state by a disappeared worker', async () => {
    const store = new InMemoryRoutineStore();
    const lifecycle = createRoutineLifecycle({ store, machines });
    const routine = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'worker-recovery-routine',
      title: 'Recover health check',
      schedule: {
        kind: 'daily',
        timeZone: 'UTC',
        localTime: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      action: { kind: 'machine_health_check', machineId: 'macmini' },
    });
    await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: routine.id,
      decision: 'approved',
    });
    const queued = await lifecycle.runNow({
      principalId: 'owner_v1',
      routineId: routine.id,
      requestKey: 'recover-this-run',
    });
    assert.equal(
      await store.replaceRun(
        {
          ...queued,
          version: 2,
          status: 'executing',
          startedAt: queued.createdAt,
        },
        1,
      ),
      true,
    );
    const worker = createRoutineWorker({
      store,
      leases: new InMemoryWorkLeaseStore(),
      lifecycle,
      concurrency: 1,
      pollIntervalMs: 10,
      leaseMs: 1_000,
    });

    assert.equal(await worker.runOnce(), 1);
    assert.equal(
      (await lifecycle.getRun('owner_v1', queued.id)).status,
      'succeeded',
    );
  });
});
