import { randomUUID } from 'node:crypto';

import type { TaskLifecycle, LifecycleObserver } from './task-lifecycle.ts';
import type { ExecutionStore } from '../ports/execution-store.ts';
import type { WorkLeaseStore } from '../ports/work-lease-store.ts';

type Clock = () => Date;

export type TaskWorker = {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  runOnce(): Promise<number>;
  checkReadiness(): Promise<void>;
};

const defaultObserver: LifecycleObserver = {
  warning: () => undefined,
};

export function createTaskWorker(options: {
  workerId?: string;
  store: ExecutionStore;
  leases: WorkLeaseStore;
  lifecycle: TaskLifecycle;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  observer?: LifecycleObserver;
  beforeWork?: () => Promise<void>;
  clock?: Clock;
  createToken?: () => string;
}): TaskWorker {
  const workerId = options.workerId ?? `worker_${randomUUID()}`;
  const observer = options.observer ?? defaultObserver;
  const clock = options.clock ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeWaiter: (() => void) | undefined;

  async function processCandidate(candidate: {
    task: { id: string; principalId: string };
    run: { id: string };
  }): Promise<boolean> {
    const acquiredAt = clock();
    const token = createToken();
    const claimed = await options.leases.claim(
      {
        schemaVersion: 1,
        runId: candidate.run.id,
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

    let progressed = true;
    try {
      await options.lifecycle.progressTask(
        candidate.task.principalId,
        candidate.task.id,
      );
    } catch (error) {
      progressed = false;
      observer.warning(error, {
        operation: 'task_worker_progress',
        workerId,
        taskId: candidate.task.id,
        runId: candidate.run.id,
      });
    } finally {
      try {
        await options.leases.release(candidate.run.id, token);
      } catch (error) {
        observer.warning(error, {
          operation: 'task_worker_lease_release',
          workerId,
          taskId: candidate.task.id,
          runId: candidate.run.id,
        });
      }
    }
    return progressed;
  }

  async function runOnce(): Promise<number> {
    const candidates = await options.store.findDispatchable(
      options.concurrency * 4,
    );
    if (candidates.length === 0) return 0;
    await options.beforeWork?.();
    let nextIndex = 0;
    let progressedCount = 0;
    const runners = Array.from(
      { length: Math.min(options.concurrency, candidates.length) },
      async () => {
        while (nextIndex < candidates.length) {
          const candidate = candidates[nextIndex];
          nextIndex += 1;
          if (candidate !== undefined && (await processCandidate(candidate))) {
            progressedCount += 1;
            return;
          }
        }
      },
    );
    await Promise.all(runners);
    return progressedCount;
  }

  function waitForWork(): Promise<void> {
    if (!running) return Promise.resolve();
    return new Promise((resolve) => {
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

  async function workLoop(): Promise<void> {
    while (running) {
      try {
        const processed = await runOnce();
        if (processed > 0) continue;
      } catch (error) {
        observer.warning(error, { operation: 'task_worker_poll', workerId });
      }
      await waitForWork();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loop = workLoop();
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
      if (!running) {
        throw new Error('The task worker is not running.');
      }
      await options.leases.checkReadiness();
    },
  };
}
