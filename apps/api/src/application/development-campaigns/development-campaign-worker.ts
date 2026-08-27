import { randomUUID } from 'node:crypto';

import type { DevelopmentCampaignStore } from '../../ports/persistence/development-campaign-store.ts';
import type { ProjectMutationLeaseStore } from '../../ports/persistence/project-mutation-lease-store.ts';
import type { DevelopmentCampaignLifecycle } from './development-campaign-lifecycle.ts';

export type DevelopmentCampaignWorker = {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  runOnce(): Promise<number>;
  checkReadiness(): Promise<void>;
};

export function createDevelopmentCampaignWorker(options: {
  workerId?: string;
  store: DevelopmentCampaignStore;
  leases: ProjectMutationLeaseStore;
  lifecycle: DevelopmentCampaignLifecycle;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
  clock?: () => Date;
  createToken?: () => string;
}): DevelopmentCampaignWorker {
  const workerId = options.workerId ?? `campaign_worker_${randomUUID()}`;
  const observer = options.observer ?? { warning: () => undefined };
  const clock = options.clock ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeWaiter: (() => void) | undefined;

  async function runOnce() {
    const candidates = await options.store.findDispatchable(
      options.concurrency * 4,
    );
    if (candidates.length === 0) return 0;
    let next = 0;
    let progressed = 0;
    const runners = Array.from(
      { length: Math.min(options.concurrency, candidates.length) },
      async () => {
        while (next < candidates.length) {
          const candidate = candidates[next++];
          if (candidate === undefined) continue;
          const acquiredAt = clock();
          const token = createToken();
          const claimed = await options.leases.claim(
            {
              schemaVersion: 1,
              projectId: candidate.approval.effect.project.id,
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
            if (result.version > candidate.version) {
              progressed += 1;
              return;
            }
          } catch (error) {
            observer.warning(error, {
              operation: 'development_campaign_worker_progress',
              campaignId: candidate.id,
              projectId: candidate.approval.effect.project.id,
              workerId,
            });
          } finally {
            await options.leases
              .release(candidate.approval.effect.project.id, token)
              .catch((error: unknown) => {
                observer.warning(error, {
                  operation: 'development_campaign_worker_lease_release',
                  campaignId: candidate.id,
                  projectId: candidate.approval.effect.project.id,
                  workerId,
                });
              });
          }
        }
      },
    );
    await Promise.all(runners);
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
        observer.warning(error, {
          operation: 'development_campaign_worker_poll',
          workerId,
        });
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
      if (running) {
        running = false;
        wakeWaiter?.();
        await loop;
        loop = undefined;
      }
    },
    wake() {
      wakeWaiter?.();
    },
    runOnce,
    async checkReadiness() {
      if (!running)
        throw new Error('The development-campaign worker is not running.');
      await Promise.all([
        options.leases.checkReadiness(),
        options.store.checkReadiness(),
      ]);
    },
  };
}
