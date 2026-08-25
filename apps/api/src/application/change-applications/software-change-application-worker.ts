import { randomUUID } from 'node:crypto';

import type { ChangeApplicationStore } from '../../ports/persistence/change-application-store.ts';
import type { ProjectMutationLeaseStore } from '../../ports/persistence/project-mutation-lease-store.ts';
import type { SoftwareChangeApplicationLifecycle } from './software-change-application-lifecycle.ts';

export type SoftwareChangeApplicationWorker = {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  runOnce(): Promise<number>;
  checkReadiness(): Promise<void>;
};

export function createSoftwareChangeApplicationWorker(options: {
  workerId?: string;
  store: ChangeApplicationStore;
  leases: ProjectMutationLeaseStore;
  lifecycle: SoftwareChangeApplicationLifecycle;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
  beforeWork?: () => Promise<void>;
  clock?: () => Date;
  createToken?: () => string;
}): SoftwareChangeApplicationWorker {
  const workerId = options.workerId ?? `application_worker_${randomUUID()}`;
  const observer = options.observer ?? { warning: () => undefined };
  const clock = options.clock ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeWaiter: (() => void) | undefined;

  async function processCandidate(candidate: {
    id: string;
    principalId: string;
    project: { id: string };
  }): Promise<boolean> {
    const acquiredAt = clock();
    const token = createToken();
    const claimed = await options.leases.claim(
      {
        schemaVersion: 1,
        projectId: candidate.project.id,
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
      await options.lifecycle.progress(candidate.principalId, candidate.id);
      return true;
    } catch (error) {
      observer.warning(error, {
        operation: 'change_application_worker_progress',
        workerId,
        applicationId: candidate.id,
        projectId: candidate.project.id,
      });
      return false;
    } finally {
      try {
        await options.leases.release(candidate.project.id, token);
      } catch (error) {
        observer.warning(error, {
          operation: 'change_application_worker_lease_release',
          workerId,
          applicationId: candidate.id,
          projectId: candidate.project.id,
        });
      }
    }
  }

  async function runOnce(): Promise<number> {
    const candidates = await options.store.findDispatchable(
      options.concurrency * 4,
    );
    if (candidates.length === 0) return 0;
    await options.beforeWork?.();
    let nextIndex = 0;
    let progressed = 0;
    const runners = Array.from(
      { length: Math.min(options.concurrency, candidates.length) },
      async () => {
        while (nextIndex < candidates.length) {
          const candidate = candidates[nextIndex];
          nextIndex += 1;
          if (candidate !== undefined && (await processCandidate(candidate))) {
            progressed += 1;
            return;
          }
        }
      },
    );
    await Promise.all(runners);
    return progressed;
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
        const count = await runOnce();
        if (count > 0) continue;
      } catch (error) {
        observer.warning(error, {
          operation: 'change_application_worker_poll',
          workerId,
        });
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
      if (!running)
        throw new Error('The change-application worker is not running.');
      await options.leases.checkReadiness();
    },
  };
}
