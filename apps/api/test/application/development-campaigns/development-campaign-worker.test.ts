import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDevelopmentCampaignWorker } from '../../../src/application/development-campaigns/development-campaign-worker.ts';
import type { DevelopmentCampaign } from '../../../src/domain/development-campaigns/development-campaign.ts';
import type { DevelopmentCampaignLifecycle } from '../../../src/application/development-campaigns/development-campaign-lifecycle.ts';
import type { DevelopmentCampaignStore } from '../../../src/ports/persistence/development-campaign-store.ts';
import type { ProjectMutationLeaseStore } from '../../../src/ports/persistence/project-mutation-lease-store.ts';

function candidate(): DevelopmentCampaign {
  return {
    id: 'campaign_worker_fixture',
    principalId: 'owner_v1',
    version: 2,
    approval: { effect: { project: { id: 'project_worker_fixture' } } },
  } as unknown as DevelopmentCampaign;
}

void describe('development campaign worker', () => {
  void it('progresses durable candidates only while holding the project lease', async () => {
    const value = candidate();
    let held = false;
    let releases = 0;
    let observedLeaseDuration = 0;
    const store = {
      findDispatchable: () => Promise.resolve([value]),
      checkReadiness: () => Promise.resolve(),
    } as unknown as DevelopmentCampaignStore;
    const leases = {
      claim(lease: { acquiredAt: string; expiresAt: string }) {
        observedLeaseDuration =
          new Date(lease.expiresAt).getTime() -
          new Date(lease.acquiredAt).getTime();
        held = true;
        return Promise.resolve(true);
      },
      release() {
        held = false;
        releases += 1;
        return Promise.resolve(true);
      },
      checkReadiness: () => Promise.resolve(),
    } as unknown as ProjectMutationLeaseStore;
    const lifecycle = {
      progress(principalId: string, campaignId: string) {
        assert.equal(held, true);
        assert.equal(principalId, value.principalId);
        assert.equal(campaignId, value.id);
        return Promise.resolve({ ...value, version: value.version + 1 });
      },
    } as unknown as DevelopmentCampaignLifecycle;
    const worker = createDevelopmentCampaignWorker({
      workerId: 'worker_fixture',
      store,
      leases,
      lifecycle,
      concurrency: 1,
      pollIntervalMs: 5_000,
      leaseMs: 31 * 60_000,
      clock: () => new Date('2026-08-27T12:00:00.000Z'),
      createToken: () => 'lease-token',
    });

    assert.equal(await worker.runOnce(), 1);
    assert.equal(observedLeaseDuration, 31 * 60_000);
    assert.equal(held, false);
    assert.equal(releases, 1);
  });

  void it('does not report a polling-only observation as progress', async () => {
    const value = candidate();
    const store = {
      findDispatchable: () => Promise.resolve([value]),
      checkReadiness: () => Promise.resolve(),
    } as unknown as DevelopmentCampaignStore;
    const leases = {
      claim: () => Promise.resolve(true),
      release: () => Promise.resolve(true),
      checkReadiness: () => Promise.resolve(),
    } as unknown as ProjectMutationLeaseStore;
    const lifecycle = {
      progress: () => Promise.resolve(value),
    } as unknown as DevelopmentCampaignLifecycle;
    const worker = createDevelopmentCampaignWorker({
      store,
      leases,
      lifecycle,
      concurrency: 1,
      pollIntervalMs: 5_000,
      leaseMs: 60_000,
    });

    assert.equal(await worker.runOnce(), 0);
  });
});
