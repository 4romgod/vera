import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerDevelopmentCampaignRoutes } from '../../../../src/adapters/inbound/http/routes/development-campaign-routes.ts';
import type { DevelopmentCampaignLifecycle } from '../../../../src/application/development-campaigns/development-campaign-lifecycle.ts';
import { DevelopmentCampaignSchema } from '../../../../src/domain/development-campaigns/development-campaign.ts';

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
              enabled: true,
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
            enabled: true,
            method: 'squash',
            requireReviewApproval: false,
            synchronizeLocalBase: true,
          },
        },
      ],
    });
    assert.doesNotMatch(response.body, /executable|arguments|projectRoot/u);
  });

  void it('forwards idempotent repair requests and exact repair decisions', async () => {
    const revision = 'a'.repeat(40);
    const campaign = DevelopmentCampaignSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: 'campaign_fixture',
      requestKey: 'campaign-key',
      principalId: 'owner_v1',
      status: 'review_required',
      approval: {
        id: 'approval_fixture',
        status: 'approved',
        reason: 'development_campaign',
        requestedAt: '2026-09-04T00:00:00.000Z',
        effect: {
          adapterId: 'local_git_github',
          completionMode: 'pull_request_only',
          approvalController: { kind: 'owner' },
          policyId: 'fixture',
          project: { id: 'project_fixture', displayName: 'Fixture' },
          repository: { owner: 'owner', name: 'fixture' },
          baseBranch: 'main',
          baseRevision: revision,
          objective: 'Repair fixture.',
          ticket: { reference: 'FIX-1', details: 'Repair fixture.' },
          delivery: {
            commitMessage: 'fix: fixture',
            pullRequest: { title: 'fix: fixture', body: '', draft: false },
          },
          capabilities: [
            {
              name: 'software_change',
              version: 1,
              destination: {
                schemaVersion: 1,
                adapterId: 'codex_cli',
                provider: 'openai',
                transport: 'local_process',
                dataBoundary: 'third_party',
              },
              authority: {
                approval: 'always',
                projectContext: 'required',
                networkAccess: 'provider_api',
                dataClasses: [
                  'owner_request',
                  'project_context',
                  'artifact_content',
                ],
                sideEffects: [
                  'third_party_disclosure',
                  'isolated_workspace_write',
                ],
                credentials: 'server_managed',
              },
            },
          ],
          qualityGates: [
            {
              id: 'quality',
              label: 'Quality',
              executable: '/usr/bin/true',
              arguments: [],
              timeoutMs: 1_000,
            },
          ],
          protectedPathPrefixes: ['.github/'],
          limits: {
            maxAttempts: 2,
            maxChangedFiles: 10,
            maxChangedBytes: 10_000,
            maxDurationMinutes: 60,
            minimumRequiredChecks: 1,
          },
          merge: {
            enabled: false,
            method: 'squash',
            requireReviewApproval: false,
            synchronizeLocalBase: false,
          },
          authority: {
            implementation: 'bounded_capabilities',
            application: 'exact_generated_patch',
            verification: 'configured_commands',
            publication: 'create_one_pull_request',
            observation: 'github_checks_and_reviews',
            merge: 'prohibited',
            directBasePush: false,
            forcePush: false,
            policyMutation: false,
          },
        },
      },
      attempts: [],
      events: [],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    const calls: unknown[] = [];
    let wakes = 0;
    const campaigns = {
      requestRepair(input: unknown) {
        calls.push(input);
        return Promise.resolve(campaign);
      },
      decideRepair(input: unknown) {
        calls.push(input);
        return Promise.resolve(campaign);
      },
      wake() {
        wakes += 1;
      },
    } as unknown as DevelopmentCampaignLifecycle & { wake(): void };
    const app = Fastify();
    apps.push(app);
    registerDevelopmentCampaignRoutes(app, {
      principalId: 'owner_v1',
      campaigns,
    });

    const requested = await app.inject({
      method: 'POST',
      url: '/v1/development-campaigns/campaign_fixture/repairs',
      headers: { 'idempotency-key': 'repair-key' },
    });
    const decided = await app.inject({
      method: 'POST',
      url: '/v1/development-campaigns/campaign_fixture/repairs/repair_fixture/decision',
      payload: { decision: 'approved' },
    });

    assert.equal(requested.statusCode, 202, requested.body);
    assert.equal(decided.statusCode, 202, decided.body);
    assert.deepEqual(calls, [
      {
        principalId: 'owner_v1',
        campaignId: 'campaign_fixture',
        requestKey: 'repair-key',
      },
      {
        principalId: 'owner_v1',
        campaignId: 'campaign_fixture',
        repairId: 'repair_fixture',
        decision: 'approved',
      },
    ]);
    assert.equal(wakes, 1);
  });
});
