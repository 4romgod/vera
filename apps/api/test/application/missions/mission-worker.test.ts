import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWorker } from '../../../src/application/missions/mission-worker.ts';
import type { MissionLifecycle } from '../../../src/application/missions/mission-lifecycle.ts';
import type { Mission } from '../../../src/domain/missions/mission.ts';
import type { MissionStore } from '../../../src/ports/persistence/mission-store.ts';
import type { WorkLeaseStore } from '../../../src/ports/persistence/work-lease-store.ts';

function candidate(): Mission {
  return {
    id: 'mission_worker_fixture',
    principalId: 'owner_v1',
    version: 2,
  } as Mission;
}

void describe('mission worker', () => {
  void it('progresses a mission only while holding its durable lease', async () => {
    const value = candidate();
    let held = false;
    let leaseRunId: string | undefined;
    let releases = 0;
    const store = {
      findDispatchable: () => Promise.resolve([value]),
      checkReadiness: () => Promise.resolve(),
    } as unknown as MissionStore;
    const leases = {
      claim(lease: { runId: string }) {
        leaseRunId = lease.runId;
        held = true;
        return Promise.resolve(true);
      },
      release() {
        held = false;
        releases += 1;
        return Promise.resolve(true);
      },
      checkReadiness: () => Promise.resolve(),
    } as unknown as WorkLeaseStore;
    const lifecycle = {
      progress(principalId: string, missionId: string) {
        assert.equal(held, true);
        assert.equal(principalId, value.principalId);
        assert.equal(missionId, value.id);
        return Promise.resolve({ ...value, version: value.version + 1 });
      },
    } as unknown as MissionLifecycle;
    const worker = createMissionWorker({
      workerId: 'mission_worker_test',
      store,
      leases,
      lifecycle,
      concurrency: 1,
      pollIntervalMs: 5_000,
      leaseMs: 60_000,
      clock: () => new Date('2026-08-27T12:00:00.000Z'),
      createToken: () => 'mission-lease-token',
    });

    assert.equal(await worker.runOnce(), 1);
    assert.equal(leaseRunId, `run_${value.id}`);
    assert.equal(held, false);
    assert.equal(releases, 1);
  });
});
