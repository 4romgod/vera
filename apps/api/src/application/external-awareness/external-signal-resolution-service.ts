import {
  ExternalSignalResolutionSchema,
  type ExternalSignalProgress,
} from '../../domain/external-awareness/external-signal-resolution.ts';
import type { ExternalSignal } from '../../domain/external-awareness/external-signal.ts';
import type { DevelopmentCampaign } from '../../domain/development-campaigns/development-campaign.ts';
import type { TaskAggregate } from '../../domain/tasks/task-aggregate.ts';
import type { ExternalAwarenessOperations } from '../../ports/external-awareness/external-awareness-operations.ts';
import type { DevelopmentCampaignStore } from '../../ports/persistence/development-campaign-store.ts';
import type { ExecutionStore } from '../../ports/persistence/execution-store.ts';

export type ExternalSignalResolutionService = ReturnType<
  typeof createExternalSignalResolutionService
>;

export function externalSignalCampaignId(
  task: TaskAggregate | null,
): string | undefined {
  if (task === null) return undefined;
  const output = task.run.output;
  if (
    output?.kind === 'software_delivery_management_result' &&
    output.result.action === 'prepare_repair'
  ) {
    return output.result.campaign.id;
  }
  const invocation = task.run.invocation;
  if (
    invocation?.capability.name === 'software_delivery_repair' &&
    'campaignId' in invocation.arguments
  ) {
    return invocation.arguments.campaignId;
  }
  const approval = task.run.approval;
  if (
    approval?.capability.name === 'software_delivery_repair' &&
    'campaignId' in approval.proposedArguments
  ) {
    return approval.proposedArguments.campaignId;
  }
  return undefined;
}

function progressForCampaign(
  signal: ExternalSignal,
  campaign: DevelopmentCampaign,
): ExternalSignalProgress {
  switch (campaign.status) {
    case 'repair_awaiting_approval':
      return {
        status: 'repair_approval_required',
        summary: 'The exact pull-request repair is ready for owner approval.',
        updatedAt: campaign.updatedAt,
      };
    case 'repairing':
    case 'implementing':
    case 'applying':
      return {
        status: 'repairing',
        summary:
          'Vera is applying the approved repair to the existing pull-request branch.',
        updatedAt: campaign.updatedAt,
      };
    case 'verifying':
    case 'publishing':
    case 'observing':
    case 'merging':
    case 'synchronizing':
      return {
        status: 'verifying',
        summary: 'Vera is verifying the repair and observing the pull request.',
        updatedAt: campaign.updatedAt,
      };
    case 'succeeded':
      return {
        status: 'awaiting_source_confirmation',
        summary:
          'The repair succeeded; Vera is waiting for GitHub observation to confirm the original signal is gone.',
        updatedAt: campaign.updatedAt,
      };
    case 'review_required':
      return {
        status: 'needs_attention',
        summary:
          campaign.failure?.message ??
          'The pull request still needs another bounded repair or owner review.',
        updatedAt: campaign.updatedAt,
      };
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return {
        status: 'needs_attention',
        summary:
          campaign.failure?.message ??
          `The repair workflow is ${campaign.status}.`,
        updatedAt: campaign.updatedAt,
      };
    case 'awaiting_approval':
    case 'approved':
      return {
        status: 'triaged',
        summary:
          'The signal is linked to a campaign, but no pull-request repair is active.',
        updatedAt: signal.lastObservedAt,
      };
  }
}

export function externalSignalProgress(
  signal: ExternalSignal,
  task: TaskAggregate | null,
  campaign: DevelopmentCampaign | null,
): ExternalSignalProgress {
  if (signal.status === 'resolved') {
    return {
      status: 'resolved',
      summary: 'The source no longer reports this signal as active.',
      updatedAt: signal.resolvedAt ?? signal.lastObservedAt,
    };
  }
  if (campaign !== null) return progressForCampaign(signal, campaign);
  if (task === null) {
    return {
      status: 'untriaged',
      summary: 'This signal has not been triaged by Vera yet.',
      updatedAt: signal.lastObservedAt,
    };
  }
  switch (task.run.status) {
    case 'deciding':
    case 'executing':
    case 'cancellation_requested':
      return {
        status: 'triaging',
        summary: 'Vera is evaluating the signal and the bounded next action.',
        updatedAt: task.run.updatedAt,
      };
    case 'awaiting_approval':
      return {
        status: 'action_approval_required',
        summary:
          'Vera has proposed a next action and is waiting for owner approval.',
        updatedAt: task.run.updatedAt,
      };
    case 'succeeded':
      return {
        status: 'triaged',
        summary: 'Vera completed triage; no active repair workflow is linked.',
        updatedAt: task.run.updatedAt,
      };
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return {
        status: 'needs_attention',
        summary:
          task.run.failure?.message ?? `Signal triage is ${task.run.status}.`,
        updatedAt: task.run.updatedAt,
      };
  }
}

export function createExternalSignalResolutionService(options: {
  awareness: Pick<ExternalAwarenessOperations, 'get'>;
  executions: ExecutionStore;
  campaigns: DevelopmentCampaignStore;
}) {
  return {
    async get(principalId: string, signalId: string) {
      const signal = await options.awareness.get(principalId, signalId);
      const task = await options.executions.findLatestByExternalSignal(
        principalId,
        signalId,
        signal.version,
      );
      const campaignId = externalSignalCampaignId(task);
      const campaign =
        campaignId === undefined
          ? null
          : await options.campaigns.findById(principalId, campaignId);
      return ExternalSignalResolutionSchema.parse({
        schemaVersion: 1,
        signal,
        progress: externalSignalProgress(signal, task, campaign),
        ...(task === null
          ? {}
          : {
              task: {
                id: task.task.id,
                runId: task.run.id,
                runStatus: task.run.status,
                ...(task.task.conversationId === undefined
                  ? {}
                  : { conversationId: task.task.conversationId }),
              },
            }),
        ...(campaign === null
          ? {}
          : {
              campaign: {
                id: campaign.id,
                status: campaign.status,
                objective: campaign.approval.effect.objective,
                ...(campaign.pullRequest === undefined
                  ? {}
                  : {
                      pullRequest: {
                        number: campaign.pullRequest.number,
                        url: campaign.pullRequest.url,
                      },
                    }),
                updatedAt: campaign.updatedAt,
              },
            }),
        links: {
          signal: `/v1/external-signals/${signal.id}`,
          source: signal.url,
          ...(task === null
            ? {}
            : {
                task: `/v1/tasks/${task.task.id}`,
                run: `/v1/runs/${task.run.id}`,
                ...(task.task.conversationId === undefined
                  ? {}
                  : {
                      conversation: `/v1/conversations/${task.task.conversationId}`,
                    }),
              }),
          ...(campaign === null
            ? {}
            : { campaign: `/v1/development-campaigns/${campaign.id}` }),
        },
      });
    },
  };
}
