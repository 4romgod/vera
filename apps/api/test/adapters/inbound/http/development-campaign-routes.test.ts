import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerDevelopmentCampaignRoutes } from '../../../../src/adapters/inbound/http/routes/development-campaign-routes.ts';
import type { DevelopmentCampaignLifecycle } from '../../../../src/application/development-campaigns/development-campaign-lifecycle.ts';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

void describe('development campaign HTTP API', () => {
  void it('exposes only safe policy summaries for registered projects', async () => {
    const campaigns = {
      listPolicies(principalId: string) {
        assert.equal(principalId, 'owner_v1');
        return Promise.resolve([
          {
            schemaVersion: 1 as const,
            id: 'fixture',
            project: { id: 'project_fixture', displayName: 'Fixture' },
            baseBranch: 'main',
            qualityGates: [
              { id: 'quality', label: 'Repository quality', timeoutMs: 60_000 },
            ],
            limits: {
              maxAttempts: 2,
              maxChangedFiles: 20,
              maxChangedBytes: 100_000,
              maxDurationMinutes: 120,
              minimumRequiredChecks: 1,
            },
            merge: {
              method: 'squash' as const,
              requireReviewApproval: false,
              synchronizeLocalBase: true,
            },
          },
        ]);
      },
    } as unknown as DevelopmentCampaignLifecycle & { wake(): void };
    const app = Fastify();
    apps.push(app);
    registerDevelopmentCampaignRoutes(app, {
      principalId: 'owner_v1',
      campaigns,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/development-campaign-policies',
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      schemaVersion: 1,
      policies: [
        {
          schemaVersion: 1,
          id: 'fixture',
          project: { id: 'project_fixture', displayName: 'Fixture' },
          baseBranch: 'main',
          qualityGates: [
            { id: 'quality', label: 'Repository quality', timeoutMs: 60_000 },
          ],
          limits: {
            maxAttempts: 2,
            maxChangedFiles: 20,
            maxChangedBytes: 100_000,
            maxDurationMinutes: 120,
            minimumRequiredChecks: 1,
          },
          merge: {
            method: 'squash',
            requireReviewApproval: false,
            synchronizeLocalBase: true,
          },
        },
      ],
    });
    assert.doesNotMatch(response.body, /executable|arguments|projectRoot/u);
  });
});
