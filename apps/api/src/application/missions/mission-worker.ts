import { randomUUID } from 'node:crypto';

import type { WorkLeaseStore } from '../../ports/persistence/work-lease-store.ts';
import type { MissionStore } from '../../ports/persistence/mission-store.ts';
import type { MissionLifecycle } from './mission-lifecycle.ts';

export type MissionWorker = {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  runOnce(): Promise<number>;
  checkReadiness(): Promise<void>;
};

export function createMissionWorker(options: {
  store: MissionStore;
  leases: WorkLeaseStore;
  lifecycle: MissionLifecycle;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  workerId?: string;
  clock?: () => Date;
  createToken?: () => string;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
}): MissionWorker {
  const workerId = options.workerId ?? `mission_worker_${randomUUID()}`;
  const clock = options.clock ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  const observer = options.observer ?? { warning: () => undefined };
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeWaiter: (() => void) | undefined;

  async function runOnce() {
    const candidates = await options.store.findDispatchable(
      options.concurrency * 4,
    );
    let progressed = 0;
    for (const candidate of candidates.slice(0, options.concurrency)) {
      const acquiredAt = clock();
      const token = createToken();
      const leaseId = `run_${candidate.id}`;
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
      if (!claimed) continue;
      try {
        const result = await options.lifecycle.progress(
          candidate.principalId,
          candidate.id,
        );
        if (result.version > candidate.version) progressed += 1;
      } catch (error) {
        observer.warning(error, {
          operation: 'mission_worker_progress',
          missionId: candidate.id,
          workerId,
        });
      } finally {
        await options.leases.release(leaseId, token).catch((error: unknown) => {
          observer.warning(error, {
            operation: 'mission_worker_lease_release',
            missionId: candidate.id,
            workerId,
          });
        });
      }
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
        observer.warning(error, { operation: 'mission_worker_poll', workerId });
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
      if (!running) throw new Error('The mission worker is not running.');
      await Promise.all([
        options.store.checkReadiness(),
        options.leases.checkReadiness(),
      ]);
    },
  };
}
