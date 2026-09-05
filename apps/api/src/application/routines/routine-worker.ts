import { randomUUID } from 'node:crypto';

import type { WorkLeaseStore } from '../../ports/persistence/work-lease-store.ts';
import type { RoutineStore } from '../../ports/persistence/routine-store.ts';
import type { RoutineLifecycle } from './routine-lifecycle.ts';

export type RoutineWorker = {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  runOnce(): Promise<number>;
  checkReadiness(): Promise<void>;
};

export function createRoutineWorker(options: {
  store: RoutineStore;
  leases: WorkLeaseStore;
  lifecycle: RoutineLifecycle;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  workerId?: string;
  clock?: () => Date;
  createToken?: () => string;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
}): RoutineWorker {
  const workerId = options.workerId ?? `routine_worker_${randomUUID()}`;
  const clock = options.clock ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  const observer = options.observer ?? { warning: () => undefined };
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeWaiter: (() => void) | undefined;
  let signalRoutineCursor: { createdAt: string; id: string } | undefined;

  async function withLease(id: string, operation: () => Promise<void>) {
    const acquiredAt = clock();
    const token = createToken();
    const leaseId = `run_routine_${id}`;
    const claimed = await options.leases.claim(
      {
        schemaVersion: 1,
        runId: leaseId,
        workerId,
        token,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: new Date(
          acquiredAt.getTime() + options.leaseMs,
        ).toISOString(),
      },
      acquiredAt.toISOString(),
    );
    if (!claimed) return false;
    try {
      await operation();
      return true;
    } finally {
      await options.leases.release(leaseId, token).catch((error: unknown) =>
        observer.warning(error, {
          operation: 'routine_worker_lease_release',
          id,
          workerId,
        }),
      );
    }
  }

  async function runOnce() {
    let progressed = 0;
    const due = await options.store.findDue(
      clock().toISOString(),
      options.concurrency * 4,
    );
    for (const routine of due.slice(0, options.concurrency)) {
      if (
        await withLease(`schedule_${routine.id}`, async () => {
          await options.lifecycle.materializeDue(routine);
        })
      )
        progressed += 1;
    }
    let triggered = await options.store.findSignalTriggered({
      ...(signalRoutineCursor === undefined
        ? {}
        : { after: signalRoutineCursor }),
      limit: options.concurrency,
    });
    if (triggered.length === 0 && signalRoutineCursor !== undefined) {
      signalRoutineCursor = undefined;
      triggered = await options.store.findSignalTriggered({
        limit: options.concurrency,
      });
    }
    // Only materialized occurrences count as progress. Claiming the lease and
    // finding nothing must let the loop sleep instead of spinning.
    for (const routine of triggered) {
      // Move the local fairness cursor before touching the routine. A single
      // malformed dependency or transient store failure must not pin every
      // later event-triggered routine behind this one forever; the failed
      // routine is visited again after the cursor wraps.
      signalRoutineCursor = {
        createdAt: routine.createdAt,
        id: routine.id,
      };
      let created = 0;
      await withLease(`signals_${routine.id}`, async () => {
        created = (
          await options.lifecycle.materializeSignalOccurrences(routine)
        ).length;
      });
      progressed += created;
    }
    const runnable = await options.store.findRunnable(options.concurrency * 4);
    for (const run of runnable.slice(0, options.concurrency)) {
      if (
        await withLease(`execute_${run.id}`, async () => {
          await options.lifecycle.executeRun(run.principalId, run.id);
        })
      )
        progressed += 1;
    }
    return progressed;
  }

  async function waitForWork() {
    if (!running) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakeWaiter = undefined;
        resolve();
      }, options.pollIntervalMs);
      wakeWaiter = () => {
        clearTimeout(timer);
        wakeWaiter = undefined;
        resolve();
      };
    });
  }
  async function workLoop() {
    while (running) {
      try {
        if ((await runOnce()) > 0) continue;
      } catch (error) {
        observer.warning(error, { operation: 'routine_worker_poll', workerId });
      }
      await waitForWork();
    }
  }
  return {
    start() {
      if (!running) {
        running = true;
        loop = workLoop();
      }
    },
    async stop() {
      if (!running) return;
      running = false;
      wakeWaiter?.();
      await loop;
      loop = undefined;
    },
    wake() {
      wakeWaiter?.();
    },
    runOnce,
    async checkReadiness() {
      if (!running) throw new Error('The routine worker is not running.');
      await Promise.all([
        options.store.checkReadiness(),
        options.leases.checkReadiness(),
      ]);
    },
  };
}
