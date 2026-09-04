import type { SoftwareChangeApplicationLifecycle } from '../../change-applications/software-change-application-lifecycle.ts';
import type { SoftwareChangePublicationLifecycle } from '../../change-applications/software-change-publication-lifecycle.ts';
import { sameCapabilityDestination } from '../../../domain/capabilities/capability-destination.ts';
import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
} from '../../../domain/capabilities/capability-registry.ts';
import type { DevelopmentCampaign } from '../../../domain/development-campaigns/development-campaign.ts';
import type { TaskAggregate } from '../../../domain/tasks/task-aggregate.ts';
import { DevelopmentCampaignOperationError } from '../../../ports/development-campaigns/development-campaign-operations.ts';
import { pathIsProtected, stableEqual } from './support.ts';

export function assertTaskApproval(
  campaign: DevelopmentCampaign,
  aggregate: TaskAggregate,
) {
  const approval = aggregate.run.approval;
  const attempt = campaign.attempts.at(-1);
  const sourceRevision =
    attempt?.sourceRevision ?? campaign.approval.effect.baseRevision;
  const requested = attempt?.requestedChange ?? {
    objective: campaign.approval.effect.objective,
    ticket: campaign.approval.effect.ticket,
  };
  if (approval?.status !== 'pending') {
    throw new DevelopmentCampaignOperationError(
      'The delegated task does not expose one pending exact approval.',
      'review_required',
    );
  }
  const allowed = campaign.approval.effect.capabilities.find(
    (capability) => capability.name === approval.capability.name,
  );
  if (
    allowed === undefined ||
    approval.destination === undefined ||
    approval.authority === undefined ||
    !sameCapabilityDestination(allowed.destination, approval.destination) ||
    !stableEqual(allowed.authority, approval.authority) ||
    approval.project?.id !== campaign.approval.effect.project.id ||
    approval.contextManifest?.revision !== sourceRevision ||
    (approval.attachments?.length ?? 0) > 0 ||
    (approval.decisionEvidence?.length ?? 0) > 0
  ) {
    throw new DevelopmentCampaignOperationError(
      'The delegated task requested authority outside the approved campaign.',
      'review_required',
    );
  }
  const schema =
    approval.capability.name === 'development_planning'
      ? DevelopmentPlanningProposalArgumentsSchema
      : SoftwareChangeProposalArgumentsSchema;
  const arguments_ = schema.parse(approval.proposedArguments);
  if (
    arguments_.objective !== requested.objective ||
    arguments_.ticket.reference !== requested.ticket.reference ||
    arguments_.ticket.details !== requested.ticket.details ||
    arguments_.project.name !== campaign.approval.effect.project.displayName
  ) {
    throw new DevelopmentCampaignOperationError(
      'The delegated capability arguments differ from the approved objective.',
      'review_required',
    );
  }
  if (
    approval.capability.name === 'development_planning' &&
    (approval.inputArtifacts?.length ?? 0) > 0
  ) {
    throw new DevelopmentCampaignOperationError(
      'Campaign planning cannot receive undeclared artifact input.',
      'review_required',
    );
  }
  if (
    approval.capability.name === 'software_change' &&
    (approval.inputArtifacts?.some(
      (artifact) => artifact.type !== 'implementation_plan',
    ) ??
      false)
  ) {
    throw new DevelopmentCampaignOperationError(
      'Campaign implementation received an unsupported input artifact.',
      'review_required',
    );
  }
}

export function assertApplicationApproval(
  campaign: DevelopmentCampaign,
  application: Awaited<ReturnType<SoftwareChangeApplicationLifecycle['get']>>,
) {
  const effect = application.approval.effect;
  const campaignEffect = campaign.approval.effect;
  const sourceRevision =
    campaign.attempts.at(-1)?.sourceRevision ?? campaignEffect.baseRevision;
  const changedBytes = effect.files.reduce(
    (total, file) => total + file.bytes,
    0,
  );
  if (
    application.project.id !== campaignEffect.project.id ||
    effect.baseRevision !== sourceRevision ||
    effect.files.length > campaignEffect.limits.maxChangedFiles ||
    changedBytes > campaignEffect.limits.maxChangedBytes ||
    effect.files.some((file) =>
      pathIsProtected(file.relativePath, campaignEffect.protectedPathPrefixes),
    )
  ) {
    throw new DevelopmentCampaignOperationError(
      'The generated patch exceeds the approved campaign application authority.',
      'review_required',
    );
  }
}

export function assertPublicationApproval(
  campaign: DevelopmentCampaign,
  publication: Awaited<ReturnType<SoftwareChangePublicationLifecycle['get']>>,
) {
  const expected = campaign.approval.effect;
  const effect = publication.approval.effect;
  if (
    effect.repository.owner.toLowerCase() !==
      expected.repository.owner.toLowerCase() ||
    effect.repository.name.toLowerCase() !==
      expected.repository.name.toLowerCase() ||
    effect.baseBranch !== expected.baseBranch ||
    effect.baseBranchRevision !== expected.baseRevision ||
    effect.commitMessage !== expected.delivery.commitMessage ||
    !stableEqual(effect.pullRequest, expected.delivery.pullRequest)
  ) {
    throw new DevelopmentCampaignOperationError(
      'The prepared publication exceeds the approved campaign authority.',
      'review_required',
    );
  }
}
