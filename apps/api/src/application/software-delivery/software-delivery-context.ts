import {
  SoftwareDeliveryContextSchema,
  SoftwareDeliveryCampaignSummarySchema,
  SoftwareDeliveryMissionSummarySchema,
  type SoftwareDeliveryContext,
  type SoftwareDeliveryResourceSummary,
} from '../../domain/software-delivery/software-delivery-management.ts';
import type { DevelopmentCampaign } from '../../domain/development-campaigns/development-campaign.ts';
import type { Mission } from '../../domain/missions/mission.ts';
import type { DevelopmentCampaignStore } from '../../ports/persistence/development-campaign-store.ts';
import type { MissionStore } from '../../ports/persistence/mission-store.ts';

const ActiveMissionStatuses = new Set([
  'awaiting_approval',
  'approved',
  'executing',
  'review_required',
]);
const ActiveCampaignStatuses = new Set([
  'awaiting_approval',
  'approved',
  'implementing',
  'applying',
  'verifying',
  'publishing',
  'observing',
  'repair_awaiting_approval',
  'repairing',
  'merging',
  'synchronizing',
  'review_required',
]);

export function missionSummary(mission: Mission) {
  return SoftwareDeliveryMissionSummarySchema.parse({
    kind: 'mission',
    id: mission.id,
    status: mission.status,
    objective: mission.approval.effect.objective,
    project: mission.approval.effect.project,
    campaignId: mission.approval.effect.campaign.id,
    ...(mission.result === undefined
      ? {}
      : {
          pullRequest: {
            number: mission.result.pullRequestNumber,
            url: mission.result.pullRequestUrl,
          },
        }),
    ...(mission.failure === undefined ? {} : { failure: mission.failure }),
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  });
}

export function campaignSummary(campaign: DevelopmentCampaign) {
  const observation = campaign.pullRequest?.observation;
  const latestRepair = campaign.repairs?.at(-1);
  const repairAvailable =
    campaign.status === 'review_required' &&
    campaign.publicationId !== undefined &&
    campaign.pullRequest !== undefined &&
    campaign.attempts.length < campaign.approval.effect.limits.maxAttempts &&
    !(
      latestRepair?.status === 'rejected' &&
      latestRepair.effect.sourceRevision === campaign.pullRequest.headRevision
    );
  return SoftwareDeliveryCampaignSummarySchema.parse({
    kind: 'development_campaign',
    id: campaign.id,
    status: campaign.status,
    objective: campaign.approval.effect.objective,
    project: campaign.approval.effect.project,
    repository: campaign.approval.effect.repository,
    attemptCount: campaign.attempts.length,
    maxAttempts: campaign.approval.effect.limits.maxAttempts,
    repairAvailable,
    ...(campaign.pullRequest === undefined
      ? {}
      : {
          pullRequest: {
            number: campaign.pullRequest.number,
            url: campaign.pullRequest.url,
            headRevision: campaign.pullRequest.headRevision,
            ...(observation === undefined
              ? {}
              : {
                  checks: {
                    pending: observation.checks.pending,
                    passed: observation.checks.passed,
                    failed: observation.checks.failed,
                  },
                  reviewDecision: observation.reviewDecision,
                }),
          },
        }),
    ...(campaign.failure === undefined ? {} : { failure: campaign.failure }),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  });
}

export function isActiveSoftwareDeliveryResource(
  resource: SoftwareDeliveryResourceSummary,
) {
  return resource.kind === 'mission'
    ? ActiveMissionStatuses.has(resource.status)
    : ActiveCampaignStatuses.has(resource.status);
}

export function createSoftwareDeliveryContextSource(options: {
  missions: MissionStore;
  campaigns: DevelopmentCampaignStore;
  clock?: () => string;
}) {
  return {
    async assemble(principalId: string): Promise<SoftwareDeliveryContext> {
      const [missions, campaigns] = await Promise.all([
        options.missions.list(principalId, 20),
        options.campaigns.list(principalId, 20),
      ]);
      const resources = [
        ...missions.map(missionSummary),
        ...campaigns.map(campaignSummary),
      ]
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 40);
      return SoftwareDeliveryContextSchema.parse({
        schemaVersion: 1,
        generatedAt: options.clock?.() ?? new Date().toISOString(),
        resources,
      });
    },
  };
}

export function shouldAssembleSoftwareDeliveryContext(message: string) {
  return /\b(missions?|campaigns?|pull requests?|pr|failed checks?|review feedback|software deliveries|repair)\b/iu.test(
    message,
  );
}
