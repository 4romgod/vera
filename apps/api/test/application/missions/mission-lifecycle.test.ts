import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryMissionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-mission-store.ts';
import { createMissionLifecycle } from '../../../src/application/missions/mission-lifecycle.ts';
import type { DevelopmentCampaignLifecycle } from '../../../src/application/development-campaigns/development-campaign-lifecycle.ts';
import type { DevelopmentCampaign } from '../../../src/domain/development-campaigns/development-campaign.ts';

const now = '2026-08-27T12:00:00.000Z';
const baseRevision = 'a'.repeat(40);
const headRevision = 'b'.repeat(40);

function campaign(): DevelopmentCampaign {
  return {
    schemaVersion: 1,
    version: 1,
    id: 'campaign_mission',
    requestKey: 'mission-campaign',
    principalId: 'owner_v1',
    status: 'awaiting_approval',
    approval: {
      id: 'approval_campaign',
      status: 'pending',
      reason: 'development_campaign',
      effect: {
        adapterId: 'local_git_github',
        completionMode: 'pull_request_only',
        approvalController: { kind: 'mission', missionId: 'mission_fixture' },
        policyId: 'vera-supervised-autonomy',
        project: { id: 'project_vera', displayName: 'Vera' },
        repository: { owner: '4romgod', name: 'vera' },
        baseBranch: 'main',
        baseRevision,
        objective: 'Select and deliver one useful Vera improvement.',
        ticket: { reference: 'MISSION', details: 'Bounded mission.' },
        delivery: {
          commitMessage: 'feat: complete bounded mission',
          pullRequest: {
            title: 'Complete bounded mission',
            body: 'Mission',
            draft: false,
          },
        },
        capabilities: [
          {
            name: 'software_change',
            version: 1,
            destination: {
              schemaVersion: 1,
              adapterId: 'codex_cli',
              provider: 'codex',
              transport: 'local_process',
              dataBoundary: 'owner_controlled',
            },
            authority: {
              approval: 'always',
              projectContext: 'required',
              networkAccess: 'none',
              dataClasses: ['owner_request', 'project_context'],
              sideEffects: ['isolated_workspace_write'],
              credentials: 'none',
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
        protectedPathPrefixes: ['apps/api/src/application/missions/'],
        limits: {
          maxAttempts: 1,
          maxChangedFiles: 20,
          maxChangedBytes: 100_000,
          maxDurationMinutes: 120,
          minimumRequiredChecks: 1,
        },
        merge: {
          enabled: false,
          method: 'squash',
          requireReviewApproval: true,
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
      requestedAt: now,
    },
    attempts: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

function setup() {
  let current = campaign();
  let campaignCreateInput: Record<string, unknown> | undefined;
  const campaignRequestKeys: unknown[] = [];
  const campaigns = {
    listPolicies: () =>
      Promise.resolve([
        {
          schemaVersion: 1 as const,
          id: 'vera-supervised-autonomy',
          project: { id: 'project_vera', displayName: 'Vera' },
          baseBranch: 'main',
          qualityGates: [],
          limits: current.approval.effect.limits,
          merge: {
            enabled: true,
            method: 'squash' as const,
            requireReviewApproval: true,
            synchronizeLocalBase: true,
          },
        },
      ]),
    create: (input: Record<string, unknown>) => {
      campaignCreateInput = structuredClone(input);
      campaignRequestKeys.push(input.requestKey);
      current = structuredClone(current);
      current.approval.effect.approvalController = input.approvalController as
        | { kind: 'owner' }
        | { kind: 'mission'; missionId: string };
      return Promise.resolve(structuredClone(current));
    },
    get: () => Promise.resolve(structuredClone(current)),
    decideApproval: (input: { decision: 'approved' | 'rejected' }) => {
      current = structuredClone(current);
      current.approval.status = input.decision;
      current.status = input.decision === 'approved' ? 'approved' : 'rejected';
      current.version += 1;
      return Promise.resolve(structuredClone(current));
    },
    decideMissionApproval: (input: {
      decision: 'approved' | 'rejected';
      missionId: string;
    }) => {
      current = structuredClone(current);
      current.approval.status = input.decision;
      current.approval.decidedBy = input.missionId;
      current.status = input.decision === 'approved' ? 'approved' : 'rejected';
      current.version += 1;
      return Promise.resolve(structuredClone(current));
    },
    cancel: () => {
      current = structuredClone(current);
      current.status = 'cancelled';
      current.version += 1;
      return Promise.resolve(structuredClone(current));
    },
  } as unknown as DevelopmentCampaignLifecycle;
  let id = 0;
  const lifecycle = createMissionLifecycle({
    store: new InMemoryMissionStore(),
    catalog: {
      schemaVersion: 1,
      policies: [
        {
          id: 'vera-bounded-mission',
          campaignPolicyId: 'vera-supervised-autonomy',
          limits: { maxCampaigns: 1, maxDurationMinutes: 240 },
        },
      ],
    },
    campaigns,
    clock: () => now,
    createId: (prefix) => `${prefix}_mission_${String(++id)}`,
  });
  return {
    lifecycle,
    campaignInput: () => campaignCreateInput,
    campaignRequestKeys: () => campaignRequestKeys,
    approveCampaign(missionId: string) {
      current = structuredClone(current);
      current.approval.status = 'approved';
      current.approval.decidedAt = now;
      current.approval.decidedBy = missionId;
      current.status = 'approved';
      current.version += 1;
    },
    completeCampaign() {
      current = structuredClone(current);
      current.status = 'succeeded';
      current.version += 1;
      current.pullRequest = {
        number: 77,
        url: 'https://github.com/4romgod/vera/pull/77',
        headRevision,
      };
      current.result = {
        outcome: 'pull_request_ready',
        pullRequestNumber: 77,
        pullRequestUrl: 'https://github.com/4romgod/vera/pull/77',
        headRevision,
        baseRevision,
        attempts: 1,
        completedAt: now,
      };
    },
    requireCampaignReview() {
      current = structuredClone(current);
      current.status = 'review_required';
      current.version += 1;
      current.failure = {
        code: 'checks_failed',
        message: 'A required pull-request check failed.',
      };
    },
    resumeCampaignRepair() {
      current = structuredClone(current);
      current.status = 'repairing';
      current.version += 1;
      delete current.failure;
    },
  };
}

void describe('mission lifecycle', () => {
  void it('freezes one no-merge campaign behind one mission approval and reports its pull request', async () => {
    const value = setup();
    const created = await value.lifecycle.createFromProposal({
      principalId: 'owner_v1',
      requestKey: 'mission-request',
      proposal: {
        action: 'create',
        objective: 'Select and deliver one useful Vera improvement.',
        completionCriteria: 'One verified pull request is ready for review.',
        project: { name: 'Vera' },
        delivery: {
          commitMessage: 'feat: complete bounded mission',
          pullRequestTitle: 'Complete bounded mission',
        },
      },
    });

    assert.equal(created.status, 'awaiting_approval');
    assert.equal(created.approval.effect.authority.mergePullRequest, false);
    assert.equal(created.approval.effect.campaign.effect.merge.enabled, false);
    assert.equal(
      created.approval.effect.campaign.effect.authority.merge,
      'prohibited',
    );
    assert.equal(value.campaignInput()?.completionMode, 'pull_request_only');

    const approved = await value.lifecycle.decideApproval({
      principalId: 'owner_v1',
      missionId: created.id,
      decision: 'approved',
    });
    const executing = await value.lifecycle.progress('owner_v1', approved.id);
    assert.equal(executing.status, 'executing');

    value.completeCampaign();
    const completed = await value.lifecycle.progress('owner_v1', approved.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result?.pullRequestNumber, 77);
    assert.equal(completed.notification?.outcome, 'succeeded');
  });

  void it('rejects the unapproved subordinate campaign when the mission is rejected', async () => {
    const value = setup();
    const created = await value.lifecycle.createFromProposal({
      principalId: 'owner_v1',
      requestKey: 'rejected-mission',
      proposal: {
        action: 'create',
        objective: 'Prepare one improvement.',
        completionCriteria: 'One pull request.',
        project: { name: 'Vera' },
        delivery: {
          commitMessage: 'feat: prepare improvement',
          pullRequestTitle: 'Prepare improvement',
        },
      },
    });
    const rejected = await value.lifecycle.decideApproval({
      principalId: 'owner_v1',
      missionId: created.id,
      decision: 'rejected',
    });
    assert.equal(rejected.status, 'rejected');
  });

  void it('uses one subordinate campaign identity for concurrent idempotent retries', async () => {
    const value = setup();
    const input = {
      principalId: 'owner_v1',
      requestKey: 'concurrent-mission',
      proposal: {
        action: 'create' as const,
        objective: 'Select and deliver one useful Vera improvement.',
        completionCriteria: 'One verified pull request is ready for review.',
        project: { name: 'Vera' },
        delivery: {
          commitMessage: 'feat: complete bounded mission',
          pullRequestTitle: 'Complete bounded mission',
        },
      },
    };
    const [first, second] = await Promise.all([
      value.lifecycle.createFromProposal(input),
      value.lifecycle.createFromProposal(input),
    ]);

    assert.equal(first.id, second.id);
    assert.equal(
      first.approval.effect.campaign.id,
      second.approval.effect.campaign.id,
    );
    assert.deepEqual(value.campaignRequestKeys(), [
      `mission:${first.id}:campaign:1`,
      `mission:${first.id}:campaign:1`,
    ]);
  });

  void it('recovers after campaign approval succeeds before mission execution is recorded', async () => {
    const value = setup();
    const created = await value.lifecycle.createFromProposal({
      principalId: 'owner_v1',
      requestKey: 'approval-crash-recovery',
      proposal: {
        action: 'create',
        objective: 'Recover one bounded campaign.',
        completionCriteria: 'One verified pull request.',
        project: { name: 'Vera' },
        delivery: {
          commitMessage: 'feat: recover bounded campaign',
          pullRequestTitle: 'Recover bounded campaign',
        },
      },
    });
    const approved = await value.lifecycle.decideApproval({
      principalId: 'owner_v1',
      missionId: created.id,
      decision: 'approved',
    });
    value.approveCampaign(approved.id);

    const executing = await value.lifecycle.progress('owner_v1', approved.id);

    assert.equal(executing.status, 'executing');
  });

  void it('keeps a mission recoverable while its campaign awaits an approved repair', async () => {
    const value = setup();
    const created = await value.lifecycle.createFromProposal({
      principalId: 'owner_v1',
      requestKey: 'repairable-mission',
      proposal: {
        action: 'create',
        objective: 'Deliver one repairable improvement.',
        completionCriteria: 'One verified pull request.',
        project: { name: 'Vera' },
        delivery: {
          commitMessage: 'feat: deliver repairable improvement',
          pullRequestTitle: 'Deliver repairable improvement',
        },
      },
    });
    const approved = await value.lifecycle.decideApproval({
      principalId: 'owner_v1',
      missionId: created.id,
      decision: 'approved',
    });
    await value.lifecycle.progress('owner_v1', approved.id);

    value.requireCampaignReview();
    const awaitingRepair = await value.lifecycle.progress(
      'owner_v1',
      approved.id,
    );
    assert.equal(awaitingRepair.status, 'executing');
    assert.equal(awaitingRepair.failure?.code, 'campaign_review_required');
    assert.equal(awaitingRepair.notification?.outcome, 'review_required');

    value.resumeCampaignRepair();
    const repairing = await value.lifecycle.progress('owner_v1', approved.id);
    assert.equal(repairing.status, 'executing');
    assert.equal(repairing.failure, undefined);

    value.completeCampaign();
    const completed = await value.lifecycle.progress('owner_v1', approved.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result?.pullRequestNumber, 77);
  });
});
