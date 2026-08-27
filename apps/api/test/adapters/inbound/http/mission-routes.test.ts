import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerMissionRoutes } from '../../../../src/adapters/inbound/http/routes/mission-routes.ts';
import type { MissionLifecycle } from '../../../../src/application/missions/mission-lifecycle.ts';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

void describe('mission HTTP API', () => {
  void it('exposes only the bounded effect summary the owner can approve', async () => {
    const missions = {
      listPolicies(principalId: string) {
        assert.equal(principalId, 'owner_v1');
        return Promise.resolve([
          {
            schemaVersion: 1 as const,
            id: 'vera-bounded-mission',
            project: { id: 'project_vera', displayName: 'Vera' },
            campaignPolicyId: 'vera-supervised-autonomy',
            limits: { maxCampaigns: 1 as const, maxDurationMinutes: 240 },
            authority: {
              selectOneOutcome: true as const,
              createDevelopmentCampaigns: 1 as const,
              createPullRequest: true as const,
              mergePullRequest: false as const,
              recurringExecution: false as const,
              missionPolicyMutation: false as const,
            },
          },
        ]);
      },
    } as unknown as MissionLifecycle & { wake(): void };
    const app = Fastify();
    apps.push(app);
    registerMissionRoutes(app, { principalId: 'owner_v1', missions });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/mission-policies',
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      policies: {
        authority: { mergePullRequest: boolean };
        limits: { maxCampaigns: number };
      }[];
    }>();
    const policy = body.policies[0];
    assert.ok(policy);
    assert.equal(policy.authority.mergePullRequest, false);
    assert.equal(policy.limits.maxCampaigns, 1);
    assert.doesNotMatch(
      response.body,
      /projectRoot|qualityGates|credentials|executable/u,
    );
  });
});
