import { createHash, randomUUID } from 'node:crypto';

import type { DevelopmentCampaignLifecycle } from '../development-campaigns/development-campaign-lifecycle.ts';
import {
  MissionSchema,
  type Mission,
  type MissionCatalog,
  type MissionEvent,
  type MissionPolicySummary,
  type MissionProposalArguments,
} from '../../domain/missions/mission.ts';
import type { MissionStore } from '../../ports/persistence/mission-store.ts';

export type MissionErrorCode =
  | 'mission_not_found'
  | 'mission_policy_not_found'
  | 'mission_project_not_found'
  | 'mission_idempotency_key_reused'
  | 'mission_approval_already_decided'
  | 'mission_concurrent_transition_failed'
  | 'mission_not_cancellable'
  | 'mission_conflict';

export class MissionError extends Error {
  public constructor(
    message: string,
    public readonly code: MissionErrorCode,
  ) {
    super(message);
    this.name = 'MissionError';
  }
}

type CreateMissionInput = Omit<MissionProposalArguments, 'project'> & {
  principalId: string;
  requestKey: string;
  projectId: string;
  policyId: string;
  source?: Mission['source'];
};

export type MissionLifecycle = {
  listPolicies(principalId: string): Promise<MissionPolicySummary[]>;
  create(input: CreateMissionInput): Promise<Mission>;
  createFromProposal(input: {
    principalId: string;
    requestKey: string;
    proposal: MissionProposalArguments;
    source?: Mission['source'];
  }): Promise<Mission>;
  get(principalId: string, missionId: string): Promise<Mission>;
  list(principalId: string): Promise<Mission[]>;
  decideApproval(input: {
    principalId: string;
    missionId: string;
    decision: 'approved' | 'rejected';
  }): Promise<Mission>;
  cancel(input: { principalId: string; missionId: string }): Promise<Mission>;
  progress(principalId: string, missionId: string): Promise<Mission>;
};

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function missionIdForRequest(principalId: string, requestKey: string) {
  const digest = createHash('sha256')
    .update(principalId)
    .update('\u0000')
    .update(requestKey)
    .digest('hex')
    .slice(0, 32);
  return `mission_${digest}`;
}

function appendEvent(
  mission: Mission,
  type: MissionEvent['type'],
  occurredAt: string,
  data: Record<string, unknown>,
  createId: (prefix: string) => string,
) {
  mission.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: mission.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

function missionNotification(
  mission: Mission,
  deliveredAt: string,
): NonNullable<Mission['notification']> {
  const pullRequestUrl = mission.result?.pullRequestUrl;
  const outcome = mission.status as
    | 'succeeded'
    | 'review_required'
    | 'failed'
    | 'cancelled';
  const message =
    outcome === 'succeeded'
      ? `Mission completed. Pull request: ${pullRequestUrl ?? 'available in mission details'}`
      : outcome === 'review_required'
        ? `Mission needs your review: ${mission.failure?.message ?? 'The campaign stopped at an authority boundary.'}`
        : outcome === 'cancelled'
          ? 'Mission cancelled.'
          : `Mission failed: ${mission.failure?.message ?? 'The campaign could not complete.'}`;
  return {
    schemaVersion: 1,
    id: `notification_${mission.id}`,
    missionId: mission.id,
    message: message.slice(0, 1_000),
    deliveredAt,
    status: 'unread',
    channel: 'vera_inbox',
    outcome,
    ...(pullRequestUrl === undefined ? {} : { pullRequestUrl }),
  };
}

export function createMissionLifecycle(options: {
  store: MissionStore;
  catalog: MissionCatalog;
  campaigns: DevelopmentCampaignLifecycle;
  clock?: () => string;
  createId?: (prefix: string) => string;
}): MissionLifecycle {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  async function requireMission(principalId: string, missionId: string) {
    const mission = await options.store.findById(principalId, missionId);
    if (mission === null) {
      throw new MissionError(
        `Mission ${missionId} was not found.`,
        'mission_not_found',
      );
    }
    return mission;
  }

  async function update(
    principalId: string,
    missionId: string,
    mutate: (mission: Mission) => boolean,
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await requireMission(principalId, missionId);
      const candidate = structuredClone(current);
      if (!mutate(candidate)) return current;
      candidate.version = current.version + 1;
      const parsed = MissionSchema.parse(candidate);
      if (await options.store.replace(parsed, current.version)) return parsed;
    }
    throw new MissionError(
      `Mission ${missionId} changed concurrently.`,
      'mission_concurrent_transition_failed',
    );
  }

  async function policies(
    principalId: string,
  ): Promise<MissionPolicySummary[]> {
    const campaignPolicies = await options.campaigns.listPolicies(principalId);
    return options.catalog.policies.flatMap((policy) => {
      const campaign = campaignPolicies.find(
        (candidate) => candidate.id === policy.campaignPolicyId,
      );
      return campaign === undefined
        ? []
        : [
            {
              schemaVersion: 1 as const,
              id: policy.id,
              project: campaign.project,
              campaignPolicyId: campaign.id,
              limits: policy.limits,
              authority: {
                selectOneOutcome: true as const,
                createDevelopmentCampaigns: 1 as const,
                createPullRequest: true as const,
                mergePullRequest: false as const,
                recurringExecution: false as const,
                missionPolicyMutation: false as const,
              },
            },
          ];
    });
  }

  function requestMatches(mission: Mission, input: CreateMissionInput) {
    const effect = mission.approval.effect;
    return (
      effect.policyId === input.policyId &&
      effect.project.id === input.projectId &&
      effect.objective === input.objective.trim() &&
      effect.completionCriteria === input.completionCriteria.trim() &&
      effect.campaign.effect.delivery.commitMessage ===
        input.delivery.commitMessage.trim() &&
      effect.campaign.effect.delivery.pullRequest.title ===
        input.delivery.pullRequestTitle.trim() &&
      stableEqual(mission.source, input.source)
    );
  }

  async function create(input: CreateMissionInput) {
    const existing = await options.store.findByRequestKey(
      input.principalId,
      input.requestKey,
    );
    if (existing !== null) {
      if (!requestMatches(existing, input)) {
        throw new MissionError(
          `Idempotency key ${input.requestKey} belongs to another mission.`,
          'mission_idempotency_key_reused',
        );
      }
      return existing;
    }
    const policy = (await policies(input.principalId)).find(
      (candidate) =>
        candidate.id === input.policyId &&
        candidate.project.id === input.projectId,
    );
    if (policy === undefined) {
      throw new MissionError(
        'No mission policy authorizes the selected project.',
        'mission_policy_not_found',
      );
    }
    // The ID also scopes the subordinate campaign idempotency key. Deriving it
    // from the owner request prevents concurrent retries from creating orphaned
    // campaigns before the mission store resolves its unique request key.
    const missionId = missionIdForRequest(input.principalId, input.requestKey);
    const campaign = await options.campaigns.create({
      principalId: input.principalId,
      requestKey: `mission:${missionId}:campaign:1`,
      projectId: policy.project.id,
      policyId: policy.campaignPolicyId,
      objective: input.objective.trim(),
      ticket: {
        reference: missionId.toUpperCase(),
        details: [
          input.objective.trim(),
          `Completion criteria: ${input.completionCriteria.trim()}`,
        ].join('\n\n'),
      },
      delivery: {
        commitMessage: input.delivery.commitMessage.trim(),
        pullRequest: {
          title: input.delivery.pullRequestTitle.trim(),
          body: [
            '## Mission',
            '',
            input.objective.trim(),
            '',
            '## Completion criteria',
            '',
            input.completionCriteria.trim(),
            '',
            `Generated by bounded Vera mission \`${missionId}\`.`,
          ].join('\n'),
          draft: false,
        },
      },
      completionMode: 'pull_request_only',
      approvalController: { kind: 'mission', missionId },
    });
    if (
      campaign.approval.effect.merge.enabled ||
      campaign.approval.effect.authority.merge !== 'prohibited'
    ) {
      throw new MissionError(
        'The subordinate campaign unexpectedly retained merge authority.',
        'mission_conflict',
      );
    }
    const now = clock();
    const approvalId = createId('approval');
    const mission = MissionSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: missionId,
      requestKey: input.requestKey,
      principalId: input.principalId,
      status: 'awaiting_approval',
      ...(input.source === undefined ? {} : { source: input.source }),
      approval: {
        id: approvalId,
        status: 'pending',
        reason: 'bounded_mission',
        effect: {
          policyId: policy.id,
          objective: input.objective.trim(),
          completionCriteria: input.completionCriteria.trim(),
          project: policy.project,
          limits: policy.limits,
          campaign: {
            id: campaign.id,
            approvalId: campaign.approval.id,
            effect: campaign.approval.effect,
          },
          authority: policy.authority,
        },
        requestedAt: now,
      },
      events: [
        {
          schemaVersion: 1,
          id: createId('event'),
          sequence: 1,
          type: 'mission_created',
          occurredAt: now,
          data: { projectId: policy.project.id, campaignId: campaign.id },
        },
        {
          schemaVersion: 1,
          id: createId('event'),
          sequence: 2,
          type: 'mission_approval_requested',
          occurredAt: now,
          data: {
            approvalId,
            campaignApprovalId: campaign.approval.id,
            mergePullRequest: false,
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    const stored = await options.store.create(mission);
    if (!stored.created && !requestMatches(stored.mission, input)) {
      throw new MissionError(
        `Idempotency key ${input.requestKey} belongs to another mission.`,
        'mission_idempotency_key_reused',
      );
    }
    return stored.mission;
  }

  async function createFromProposal(input: {
    principalId: string;
    requestKey: string;
    proposal: MissionProposalArguments;
    source?: Mission['source'];
  }) {
    const available = (await policies(input.principalId)).filter(
      (policy) =>
        policy.project.displayName.toLowerCase() ===
        input.proposal.project.name.toLowerCase(),
    );
    if (available.length !== 1) {
      throw new MissionError(
        available.length === 0
          ? `No mission policy was found for project ${input.proposal.project.name}.`
          : `Project ${input.proposal.project.name} has multiple mission policies; select one through the mission API.`,
        available.length === 0
          ? 'mission_project_not_found'
          : 'mission_policy_not_found',
      );
    }
    const policy = available[0];
    if (policy === undefined) throw new Error('Mission policy disappeared.');
    return create({
      ...input.proposal,
      principalId: input.principalId,
      requestKey: input.requestKey,
      projectId: policy.project.id,
      policyId: policy.id,
      ...(input.source === undefined ? {} : { source: input.source }),
    });
  }

  async function terminate(
    mission: Mission,
    status: 'succeeded' | 'review_required' | 'failed' | 'cancelled',
    input: {
      result?: Mission['result'];
      failure?: Mission['failure'];
      event: MissionEvent['type'];
      data?: Record<string, unknown>;
    },
  ) {
    const now = clock();
    return update(mission.principalId, mission.id, (candidate) => {
      if (!['approved', 'executing'].includes(candidate.status)) return false;
      candidate.status = status;
      if (input.result !== undefined) candidate.result = input.result;
      if (input.failure !== undefined) candidate.failure = input.failure;
      candidate.updatedAt = now;
      appendEvent(candidate, input.event, now, input.data ?? {}, createId);
      candidate.notification = missionNotification(candidate, now);
      appendEvent(
        candidate,
        'mission_notification_delivered',
        now,
        { notificationId: candidate.notification.id },
        createId,
      );
      return true;
    });
  }

  async function progress(principalId: string, missionId: string) {
    const mission = await requireMission(principalId, missionId);
    const effect = mission.approval.effect;
    const expiresAt =
      Date.parse(mission.createdAt) + effect.limits.maxDurationMinutes * 60_000;
    if (Date.parse(clock()) > expiresAt) {
      await options.campaigns
        .cancel({ principalId, campaignId: effect.campaign.id })
        .catch(() => undefined);
      return terminate(mission, 'review_required', {
        failure: {
          code: 'mission_expired',
          message: 'The mission exceeded its approved wall-clock duration.',
        },
        event: 'mission_review_required',
      });
    }
    if (mission.status === 'approved') {
      const campaign = await options.campaigns.get(
        principalId,
        effect.campaign.id,
      );
      if (
        campaign.approval.id !== effect.campaign.approvalId ||
        !stableEqual(campaign.approval.effect, effect.campaign.effect)
      ) {
        return terminate(mission, 'review_required', {
          failure: {
            code: 'mission_conflict',
            message:
              'The frozen development campaign no longer matches the approved mission.',
          },
          event: 'mission_review_required',
        });
      }
      if (campaign.approval.status === 'pending') {
        await options.campaigns.decideMissionApproval({
          principalId,
          campaignId: campaign.id,
          missionId: mission.id,
          decision: 'approved',
        });
      } else if (
        campaign.approval.status !== 'approved' ||
        campaign.approval.decidedBy !== mission.id ||
        ['rejected', 'failed', 'review_required', 'cancelled'].includes(
          campaign.status,
        )
      ) {
        return terminate(mission, 'review_required', {
          failure: {
            code: 'mission_conflict',
            message:
              'The subordinate campaign approval no longer matches the approved mission.',
          },
          event: 'mission_review_required',
        });
      }
      const now = clock();
      return update(principalId, missionId, (candidate) => {
        if (candidate.status !== 'approved') return false;
        candidate.status = 'executing';
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          'mission_campaign_delegated',
          now,
          { campaignId: campaign.id, campaignApprovalId: campaign.approval.id },
          createId,
        );
        return true;
      });
    }
    if (mission.status !== 'executing') return mission;
    const campaign = await options.campaigns.get(
      principalId,
      effect.campaign.id,
    );
    if (campaign.status === 'succeeded') {
      if (campaign.result?.outcome !== 'pull_request_ready') {
        return terminate(mission, 'review_required', {
          failure: {
            code: 'mission_conflict',
            message:
              'The campaign completed outside the approved no-merge boundary.',
          },
          event: 'mission_review_required',
        });
      }
      return terminate(mission, 'succeeded', {
        result: {
          outcome: 'pull_request_ready',
          campaignId: campaign.id,
          pullRequestNumber: campaign.result.pullRequestNumber,
          pullRequestUrl: campaign.result.pullRequestUrl,
          completedAt: clock(),
        },
        event: 'mission_succeeded',
        data: { pullRequestUrl: campaign.result.pullRequestUrl },
      });
    }
    if (campaign.status === 'review_required') {
      const now = clock();
      return update(principalId, missionId, (candidate) => {
        if (candidate.status !== 'executing') return false;
        const last = candidate.events.at(-1);
        if (
          last?.type === 'mission_progress_observed' &&
          last.data.campaignVersion === campaign.version
        )
          return false;
        candidate.failure = {
          code: 'campaign_review_required',
          message:
            campaign.failure?.message ?? 'The campaign requires owner review.',
        };
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          'mission_progress_observed',
          now,
          {
            campaignStatus: campaign.status,
            campaignVersion: campaign.version,
            ownerAction: 'review_or_repair_campaign',
          },
          createId,
        );
        candidate.notification = missionNotification(
          { ...candidate, status: 'review_required' },
          now,
        );
        appendEvent(
          candidate,
          'mission_notification_delivered',
          now,
          { notificationId: candidate.notification.id },
          createId,
        );
        return true;
      });
    }
    if (campaign.status === 'failed') {
      return terminate(mission, 'failed', {
        failure: {
          code: 'campaign_failed',
          message: campaign.failure?.message ?? 'The campaign failed.',
        },
        event: 'mission_failed',
      });
    }
    if (campaign.status === 'cancelled' || campaign.status === 'rejected') {
      return terminate(mission, 'cancelled', {
        failure: {
          code: 'campaign_cancelled',
          message: 'The campaign stopped.',
        },
        event: 'mission_cancelled',
      });
    }
    const now = clock();
    return update(principalId, missionId, (candidate) => {
      if (candidate.status !== 'executing') return false;
      const last = candidate.events.at(-1);
      if (
        last?.type === 'mission_progress_observed' &&
        last.data.campaignVersion === campaign.version
      )
        return false;
      candidate.updatedAt = now;
      if (campaign.status !== 'review_required') delete candidate.failure;
      appendEvent(
        candidate,
        'mission_progress_observed',
        now,
        { campaignStatus: campaign.status, campaignVersion: campaign.version },
        createId,
      );
      return true;
    });
  }

  return {
    listPolicies: policies,
    create,
    createFromProposal,
    get: requireMission,
    list: (principalId) => options.store.list(principalId, 50),
    async decideApproval(input) {
      const current = await requireMission(input.principalId, input.missionId);
      if (current.approval.status !== 'pending') {
        if (
          current.approval.status === input.decision &&
          current.approval.decidedBy === input.principalId
        )
          return current;
        throw new MissionError(
          `Mission approval ${current.approval.id} was already decided.`,
          'mission_approval_already_decided',
        );
      }
      const now = clock();
      const decided = await update(
        input.principalId,
        input.missionId,
        (candidate) => {
          if (candidate.approval.status !== 'pending') return false;
          candidate.approval.status = input.decision;
          candidate.approval.decidedAt = now;
          candidate.approval.decidedBy = input.principalId;
          candidate.status =
            input.decision === 'approved' ? 'approved' : 'rejected';
          candidate.updatedAt = now;
          appendEvent(
            candidate,
            input.decision === 'approved'
              ? 'mission_approval_approved'
              : 'mission_approval_rejected',
            now,
            { approvalId: candidate.approval.id },
            createId,
          );
          return true;
        },
      );
      if (input.decision === 'rejected') {
        await options.campaigns
          .decideMissionApproval({
            principalId: input.principalId,
            campaignId: decided.approval.effect.campaign.id,
            missionId: decided.id,
            decision: 'rejected',
          })
          .catch(() => undefined);
      }
      return decided;
    },
    async cancel(input) {
      const current = await requireMission(input.principalId, input.missionId);
      if (
        [
          'succeeded',
          'rejected',
          'review_required',
          'failed',
          'cancelled',
        ].includes(current.status)
      )
        return current;
      try {
        if (current.approval.status === 'pending') {
          await options.campaigns.decideMissionApproval({
            principalId: input.principalId,
            campaignId: current.approval.effect.campaign.id,
            missionId: current.id,
            decision: 'rejected',
          });
        } else {
          await options.campaigns.cancel({
            principalId: input.principalId,
            campaignId: current.approval.effect.campaign.id,
          });
        }
      } catch {
        throw new MissionError(
          'The mission can no longer guarantee cancellation of its campaign.',
          'mission_not_cancellable',
        );
      }
      const now = clock();
      return update(input.principalId, input.missionId, (candidate) => {
        if (
          [
            'succeeded',
            'rejected',
            'review_required',
            'failed',
            'cancelled',
          ].includes(candidate.status)
        )
          return false;
        candidate.status = 'cancelled';
        candidate.failure = {
          code: 'cancelled',
          message: 'Mission cancelled.',
        };
        candidate.updatedAt = now;
        appendEvent(candidate, 'mission_cancelled', now, {}, createId);
        candidate.notification = missionNotification(candidate, now);
        appendEvent(
          candidate,
          'mission_notification_delivered',
          now,
          { notificationId: candidate.notification.id },
          createId,
        );
        return true;
      });
    },
    progress,
  };
}
