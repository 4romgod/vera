import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import { InMemoryWorkLeaseStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-work-lease-store.ts';
import { createTaskWorker } from '../../../src/application/tasks/task-worker.ts';
import type { TaskLifecycle } from '../../../src/application/tasks/task-lifecycle.ts';
import { TaskAggregateSchema } from '../../../src/domain/tasks/task-aggregate.ts';

function decidingAggregate(taskId: string, runId: string) {
  return TaskAggregateSchema.parse({
    schemaVersion: 1,
    version: 1,
    task: {
      id: taskId,
      requestKey: taskId,
      principalId: 'owner_v1',
      message: 'hello',
      status: 'active',
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:00:00.000Z',
    },
    run: {
      id: runId,
      status: 'deciding',
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:00:00.000Z',
    },
    events: [],
  });
}

function lifecycle(progressTask: TaskLifecycle['progressTask']): TaskLifecycle {
  const unavailable = (): never => {
    throw new Error('Unexpected lifecycle call.');
  };
  return {
    submit: unavailable,
    getTask: unavailable,
    getRun: unavailable,
    decideApproval: unavailable,
    cancelRun: unavailable,
    progressTask,
    recoverInterrupted: () => Promise.resolve(),
  };
}

void describe('task worker', () => {
  void it('allows only one worker to progress a run with an active lease', async () => {
    const store = new InMemoryExecutionStore();
    await store.create(
      decidingAggregate('task_worker_race', 'run_worker_race'),
    );
    const leases = new InMemoryWorkLeaseStore();
    const processing = Promise.withResolvers<undefined>();
    let calls = 0;
    const taskLifecycle = lifecycle(async () => {
      calls += 1;
      await processing.promise;
      return decidingAggregate('task_worker_race', 'run_worker_race');
    });
    const common = {
      store,
      leases,
      lifecycle: taskLifecycle,
      concurrency: 1,
      pollIntervalMs: 25,
      leaseMs: 60_000,
      clock: () => new Date('2026-08-25T10:00:00.000Z'),
    };
    const first = createTaskWorker({
      ...common,
      workerId: 'worker_first',
      createToken: () => 'token_first',
    });
    const second = createTaskWorker({
      ...common,
      workerId: 'worker_second',
      createToken: () => 'token_second',
    });

    const firstRun = first.runOnce();
    while (calls === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const secondResult = await second.runOnce();
    assert.equal(secondResult, 0);
    assert.equal(calls, 1);
    processing.resolve(undefined);
    assert.equal(await firstRun, 1);
  });

  void it('reclaims an expired lease after a worker disappears', async () => {
    const store = new InMemoryExecutionStore();
    await store.create(
      decidingAggregate('task_worker_expiry', 'run_worker_expiry'),
    );
    const leases = new InMemoryWorkLeaseStore();
    await leases.claim(
      {
        schemaVersion: 1,
        runId: 'run_worker_expiry',
        workerId: 'worker_gone',
        token: 'token_gone',
        acquiredAt: '2026-08-25T09:59:00.000Z',
        expiresAt: '2026-08-25T09:59:30.000Z',
      },
      '2026-08-25T09:59:00.000Z',
    );
    let calls = 0;
    const worker = createTaskWorker({
      workerId: 'worker_recovery',
      store,
      leases,
      lifecycle: lifecycle((principalId, taskId) => {
        calls += 1;
        return store.findByTaskId(principalId, taskId).then((aggregate) => {
          assert.ok(aggregate);
          return aggregate;
        });
      }),
      concurrency: 1,
      pollIntervalMs: 25,
      leaseMs: 60_000,
      clock: () => new Date('2026-08-25T10:00:00.000Z'),
      createToken: () => 'token_recovery',
    });

    assert.equal(await worker.runOnce(), 1);
    assert.equal(calls, 1);
  });
});
