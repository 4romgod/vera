import {
  SoftwareDeliveryManagementResultSchema,
  type SoftwareDeliveryActionArguments,
} from '../../domain/software-delivery/software-delivery-management.ts';
import type { DevelopmentCampaignLifecycle } from '../development-campaigns/development-campaign-lifecycle.ts';
import type { MissionLifecycle } from '../missions/mission-lifecycle.ts';
import {
  campaignSummary,
  isActiveSoftwareDeliveryResource,
  missionSummary,
} from './software-delivery-context.ts';

function statusSummary(resource: ReturnType<typeof campaignSummary>) {
  const pullRequest = resource.pullRequest;
  const checks = pullRequest?.checks;
  return [
    `${resource.project.displayName}: ${resource.objective}`,
    `Campaign status: ${resource.status}.`,
    ...(pullRequest === undefined
      ? []
      : [
          `Pull request #${String(pullRequest.number)}: ${pullRequest.url}`,
          ...(checks === undefined
            ? []
            : [
                `Checks: ${String(checks.passed)} passed, ${String(checks.pending)} pending, ${String(checks.failed)} failed.`,
              ]),
        ]),
    ...(resource.failure === undefined ? [] : [resource.failure.message]),
  ].join(' ');
}

export function createSoftwareDeliveryControlService(options: {
  missions: MissionLifecycle;
  campaigns: DevelopmentCampaignLifecycle;
}) {
  return {
    async invoke(input: {
      principalId: string;
      requestKey: string;
      arguments: SoftwareDeliveryActionArguments;
    }) {
      if (input.arguments.action === 'list') {
        const scope = input.arguments.scope;
        const [missions, campaigns] = await Promise.all([
          options.missions.list(input.principalId),
          options.campaigns.list(input.principalId),
        ]);
        const resources = [
          ...missions.map(missionSummary),
          ...campaigns.map(campaignSummary),
        ]
          .filter((resource) =>
            scope === 'all' ? true : isActiveSoftwareDeliveryResource(resource),
          )
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              left.id.localeCompare(right.id),
          )
          .slice(0, 40);
        return SoftwareDeliveryManagementResultSchema.parse({
          schemaVersion: 1,
          action: 'list',
          summary:
            resources.length === 0
              ? `You have no ${scope === 'all' ? '' : 'active '}software missions or development campaigns.`
              : `I found ${String(resources.length)} ${scope === 'all' ? '' : 'active '}software delivery resource${resources.length === 1 ? '' : 's'}.`,
          resources,
        });
      }
      if (input.arguments.action === 'inspect') {
        const resource =
          input.arguments.target.kind === 'mission'
            ? missionSummary(
                await options.missions.get(
                  input.principalId,
                  input.arguments.target.id,
                ),
              )
            : campaignSummary(
                await options.campaigns.get(
                  input.principalId,
                  input.arguments.target.id,
                ),
              );
        const summary =
          resource.kind === 'mission'
            ? `${resource.project.displayName}: ${resource.objective} Mission status: ${resource.status}.${resource.pullRequest === undefined ? '' : ` Pull request #${String(resource.pullRequest.number)}: ${resource.pullRequest.url}`}${resource.failure === undefined ? '' : ` ${resource.failure.message}`}`
            : statusSummary(resource);
        return SoftwareDeliveryManagementResultSchema.parse({
          schemaVersion: 1,
          action: 'inspect',
          summary,
          resource,
        });
      }
      const campaign = await options.campaigns.requestRepair({
        principalId: input.principalId,
        campaignId: input.arguments.campaignId,
        requestKey: input.requestKey,
      });
      const repair = campaign.repairs?.at(-1);
      if (repair?.requestKey !== input.requestKey) {
        throw new Error('The prepared campaign repair could not be recovered.');
      }
      return SoftwareDeliveryManagementResultSchema.parse({
        schemaVersion: 1,
        action: 'prepare_repair',
        summary: `I prepared an exact repair for pull request #${String(repair.effect.pullRequest.number)} at head ${repair.effect.sourceRevision.slice(0, 12)}. Review and approve it before Vera changes the branch.`,
        campaign: campaignSummary(campaign),
        repair,
      });
    },
  };
}
