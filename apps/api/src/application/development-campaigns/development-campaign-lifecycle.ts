import { randomUUID } from 'node:crypto';

import type { SoftwareChangeApplicationLifecycle } from '../change-applications/software-change-application-lifecycle.ts';
import type { SoftwareChangePublicationLifecycle } from '../change-applications/software-change-publication-lifecycle.ts';
import type { TaskLifecycle } from '../tasks/task-lifecycle.ts';
import { sameCapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
} from '../../domain/capabilities/capability-registry.ts';
import {
  DevelopmentCampaignSchema,
  type DevelopmentCampaign,
  type DevelopmentCampaignEffect,
  type DevelopmentCampaignEvent,
} from '../../domain/development-campaigns/development-campaign.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';
import type { DevelopmentCampaignStore } from '../../ports/persistence/development-campaign-store.ts';
import type { CapabilityRuntimeRegistry } from '../../ports/capabilities/capability-runtime.ts';
import {
  DevelopmentCampaignOperationError,
  type DevelopmentCampaignOperations,
} from '../../ports/development-campaigns/development-campaign-operations.ts';
import type { TaskAggregate } from '../../domain/tasks/task-aggregate.ts';

export type DevelopmentCampaignErrorCode =
  | 'development_campaign_not_found'
  | 'development_campaign_idempotency_key_reused'
  | 'development_campaign_project_not_found'
  | 'development_campaign_capability_unavailable'
  | 'development_campaign_approval_already_decided'
  | 'development_campaign_concurrent_transition_failed'
  | 'development_campaign_not_cancellable';

export class DevelopmentCampaignError extends Error {
  public constructor(
    message: string,
    public readonly code: DevelopmentCampaignErrorCode,
  ) {
    super(message);
    this.name = 'DevelopmentCampaignError';
  }
}

type Clock = () => string;
type IdFactory = (prefix: string) => string;

export type DevelopmentCampaignLifecycle = {
  listPolicies(
    principalId: string,
  ): Promise<
    import('../../domain/development-campaigns/development-campaign.ts').DevelopmentCampaignPolicySummary[]
  >;
  create(input: {
    principalId: string;
    requestKey: string;
    projectId: string;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: DevelopmentCampaignEffect['delivery'];
  }): Promise<DevelopmentCampaign>;
  get(principalId: string, campaignId: string): Promise<DevelopmentCampaign>;
  list(principalId: string): Promise<DevelopmentCampaign[]>;
  decideApproval(input: {
    principalId: string;
    campaignId: string;
    decision: 'approved' | 'rejected';
  }): Promise<DevelopmentCampaign>;
  cancel(input: {
    principalId: string;
    campaignId: string;
  }): Promise<DevelopmentCampaign>;
  progress(
    principalId: string,
    campaignId: string,
  ): Promise<DevelopmentCampaign>;
};

function appendEvent(
  campaign: DevelopmentCampaign,
  type: DevelopmentCampaignEvent['type'],
  occurredAt: string,
  data: Record<string, unknown>,
  createId: IdFactory,
) {
  campaign.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: campaign.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathIsProtected(path: string, prefixes: string[]) {
  const normalized = path.replace(/^\.\//u, '').replace(/\\/gu, '/');
  return prefixes.some((candidate) => {
    const prefix = candidate.replace(/^\.\//u, '').replace(/\\/gu, '/');
    return (
      normalized === prefix.replace(/\/$/u, '') || normalized.startsWith(prefix)
    );
  });
}

function softwareChangeArtifactId(
  aggregate: TaskAggregate,
): string | undefined {
  const output = aggregate.run.output;
  if (output === undefined) return undefined;
  if (output.kind === 'software_change') return output.artifact?.id;
  if (output.kind === 'goal_result' || output.kind === 'adaptive_goal_result') {
    return output.artifacts.find(
      (artifact) => artifact.type === 'software_change',
    )?.id;
  }
  return undefined;
}

function repairMessage(
  effect: DevelopmentCampaignEffect,
  attempt: number,
  previous?: DevelopmentCampaign['attempts'][number]['verification'],
) {
  const failure = previous?.gates.find((gate) => gate.status === 'failed');
  return [
    'Implement the following development-campaign objective as one complete software change.',
    'The objective, ticket reference, ticket details, and project name must be copied exactly into any capability proposal.',
    `Objective: ${effect.objective}`,
    `Ticket reference: ${effect.ticket.reference}`,
    `Ticket details: ${effect.ticket.details}`,
    `Project name: ${effect.project.displayName}`,
    `Campaign attempt: ${String(attempt)} of ${String(effect.limits.maxAttempts)}.`,
    ...(failure === undefined
      ? []
      : [
          'The previous replacement patch was retired from this campaign after its configured quality gate failed.',
          `Failed gate: ${failure.label} (${failure.id}).`,
          `Bounded gate output:\n${failure.output}`,
          'Generate a complete replacement change from the unchanged approved base; do not reuse or depend on the retired workspace.',
        ]),
  ].join('\n\n');
}

export function createDevelopmentCampaignLifecycle(options: {
  store: DevelopmentCampaignStore;
  projects: ProjectStore;
  tasks: TaskLifecycle;
  applications: SoftwareChangeApplicationLifecycle;
  publications: SoftwareChangePublicationLifecycle;
  capabilities: CapabilityRuntimeRegistry;
  operations: DevelopmentCampaignOperations;
  clock?: Clock;
  createId?: IdFactory;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
}): DevelopmentCampaignLifecycle {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const observer = options.observer ?? { warning: () => undefined };

  async function requireCampaign(principalId: string, campaignId: string) {
    const campaign = await options.store.findById(principalId, campaignId);
    if (campaign === null) {
      throw new DevelopmentCampaignError(
        `Development campaign ${campaignId} was not found.`,
        'development_campaign_not_found',
      );
    }
    return campaign;
  }

  async function update(
    principalId: string,
    campaignId: string,
    transition: (candidate: DevelopmentCampaign) => boolean,
  ) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await requireCampaign(principalId, campaignId);
      const candidate = structuredClone(current);
      if (!transition(candidate)) return current;
      candidate.version = current.version + 1;
      DevelopmentCampaignSchema.parse(candidate);
      if (await options.store.replace(candidate, current.version))
        return candidate;
    }
    throw new DevelopmentCampaignError(
      `Development campaign ${campaignId} changed too frequently.`,
      'development_campaign_concurrent_transition_failed',
    );
  }

  async function requireProject(campaign: DevelopmentCampaign) {
    const project = await options.projects.findProjectById(
      campaign.principalId,
      campaign.approval.effect.project.id,
    );
    if (project === null) {
      throw new DevelopmentCampaignOperationError(
        'The campaign project is no longer registered.',
        'campaign_conflict',
      );
    }
    return project;
  }

  function assertTaskApproval(
    campaign: DevelopmentCampaign,
    aggregate: TaskAggregate,
  ) {
    const approval = aggregate.run.approval;
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
      approval.contextManifest?.revision !==
        campaign.approval.effect.baseRevision ||
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
    const effect = campaign.approval.effect;
    if (
      arguments_.objective !== effect.objective ||
      arguments_.ticket.reference !== effect.ticket.reference ||
      arguments_.ticket.details !== effect.ticket.details ||
      arguments_.project.name !== effect.project.displayName
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

  function assertApplicationApproval(
    campaign: DevelopmentCampaign,
    application: Awaited<ReturnType<SoftwareChangeApplicationLifecycle['get']>>,
  ) {
    const effect = application.approval.effect;
    const campaignEffect = campaign.approval.effect;
    const changedBytes = effect.files.reduce(
      (total, file) => total + file.bytes,
      0,
    );
    if (
      application.project.id !== campaignEffect.project.id ||
      effect.baseRevision !== campaignEffect.baseRevision ||
      effect.files.length > campaignEffect.limits.maxChangedFiles ||
      changedBytes > campaignEffect.limits.maxChangedBytes ||
      effect.files.some((file) =>
        pathIsProtected(
          file.relativePath,
          campaignEffect.protectedPathPrefixes,
        ),
      )
    ) {
      throw new DevelopmentCampaignOperationError(
        'The generated patch exceeds the approved campaign application authority.',
        'review_required',
      );
    }
  }

  function assertPublicationApproval(
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

  async function fail(campaign: DevelopmentCampaign, error: unknown) {
    const operationError =
      error instanceof DevelopmentCampaignOperationError ? error : undefined;
    const code =
      operationError?.code === 'review_required'
        ? ('review_required' as const)
        : operationError?.code === 'verification_failed'
          ? ('verification_failed' as const)
          : operationError?.code === 'publication_failed'
            ? ('publication_failed' as const)
            : operationError?.code === 'checks_failed'
              ? ('checks_failed' as const)
              : operationError?.code === 'merge_failed'
                ? ('merge_failed' as const)
                : operationError?.code === 'synchronization_failed'
                  ? ('synchronization_failed' as const)
                  : campaign.status === 'implementing'
                    ? ('implementation_failed' as const)
                    : ('campaign_conflict' as const);
    const reviewRequired = ['review_required', 'checks_failed'].includes(code);
    const message =
      operationError?.message ??
      'Vera could not continue the approved development campaign.';
    observer.warning(error, {
      operation: 'development_campaign',
      campaignId: campaign.id,
      status: campaign.status,
      errorCode: code,
    });
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (
        [
          'succeeded',
          'rejected',
          'failed',
          'review_required',
          'cancelled',
        ].includes(candidate.status)
      )
        return false;
      candidate.status = reviewRequired ? 'review_required' : 'failed';
      candidate.failure = { code, message };
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        reviewRequired
          ? 'development_campaign_review_required'
          : 'development_campaign_failed',
        now,
        { code },
        createId,
      );
      return true;
    });
  }

  function requestMatches(
    campaign: DevelopmentCampaign,
    input: Parameters<DevelopmentCampaignLifecycle['create']>[0],
  ) {
    const effect = campaign.approval.effect;
    return (
      effect.project.id === input.projectId &&
      effect.policyId === input.policyId &&
      effect.objective === input.objective.trim() &&
      stableEqual(effect.ticket, {
        reference: input.ticket.reference.trim(),
        details: input.ticket.details.trim(),
      }) &&
      stableEqual(effect.delivery, {
        commitMessage: input.delivery.commitMessage.trim(),
        pullRequest: {
          title: input.delivery.pullRequest.title.trim(),
          body: input.delivery.pullRequest.body,
          draft: false,
        },
      })
    );
  }

  async function progressApproved(campaign: DevelopmentCampaign) {
    const effect = campaign.approval.effect;
    const project = await requireProject(campaign);
    await options.operations.assertProjectBase({ project, effect });
    const previous = campaign.attempts.at(-1)?.verification;
    const number = campaign.attempts.length + 1;
    const task = await options.tasks.submit({
      principalId: campaign.principalId,
      requestKey: `development-campaign:${campaign.id}:attempt:${String(number)}`,
      projectId: effect.project.id,
      message: repairMessage(effect, number, previous),
    });
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (candidate.status !== 'approved') return false;
      candidate.status = 'implementing';
      candidate.attempts.push({
        number,
        taskId: task.task.id,
        runId: task.run.id,
      });
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        number === 1
          ? 'development_campaign_attempt_started'
          : 'development_campaign_repair_started',
        now,
        { attempt: number, taskId: task.task.id, runId: task.run.id },
        createId,
      );
      return true;
    });
  }

  async function progressImplementation(campaign: DevelopmentCampaign) {
    const attempt = campaign.attempts.at(-1);
    if (attempt === undefined) throw new Error('Campaign attempt is missing.');
    let aggregate = await options.tasks.getTask(
      campaign.principalId,
      attempt.taskId,
    );
    if (aggregate.run.status === 'deciding') {
      aggregate = await options.tasks.progressTask(
        campaign.principalId,
        aggregate.task.id,
      );
    }
    if (
      aggregate.run.status === 'awaiting_approval' &&
      aggregate.run.approval?.status === 'pending'
    ) {
      assertTaskApproval(campaign, aggregate);
      const approvalId = aggregate.run.approval.id;
      aggregate = await options.tasks.decideApproval({
        principalId: campaign.principalId,
        approvalId,
        decision: 'approved',
      });
      const now = clock();
      await update(campaign.principalId, campaign.id, (candidate) => {
        if (candidate.status !== 'implementing') return false;
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          'development_campaign_task_approval_delegated',
          now,
          {
            attempt: attempt.number,
            approvalId,
            capability: aggregate.run.approval?.capability.name,
          },
          createId,
        );
        return true;
      });
      return requireCampaign(campaign.principalId, campaign.id);
    }
    if (
      [
        'deciding',
        'awaiting_approval',
        'executing',
        'cancellation_requested',
      ].includes(aggregate.run.status)
    )
      return campaign;
    if (aggregate.run.status !== 'succeeded') {
      throw new DevelopmentCampaignOperationError(
        'The delegated implementation task did not succeed.',
        'campaign_conflict',
      );
    }
    const artifactId = softwareChangeArtifactId(aggregate);
    if (artifactId === undefined) {
      throw new DevelopmentCampaignOperationError(
        'The delegated implementation completed without a software-change artifact.',
        'campaign_conflict',
      );
    }
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (candidate.status !== 'implementing') return false;
      const current = candidate.attempts.at(-1);
      if (current?.taskId !== aggregate.task.id) return false;
      current.artifactId = artifactId;
      candidate.status = 'applying';
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_change_produced',
        now,
        { attempt: current.number, artifactId },
        createId,
      );
      return true;
    });
  }

  async function progressApplication(campaign: DevelopmentCampaign) {
    const attempt = campaign.attempts.at(-1);
    if (attempt?.artifactId === undefined)
      throw new Error('Campaign software-change artifact is missing.');
    let application =
      attempt.applicationId === undefined
        ? await options.applications.create({
            principalId: campaign.principalId,
            requestKey: `development-campaign:${campaign.id}:application:${String(attempt.number)}`,
            artifactId: attempt.artifactId,
          })
        : await options.applications.get(
            campaign.principalId,
            attempt.applicationId,
          );
    if (attempt.applicationId === undefined) {
      const now = clock();
      campaign = await update(
        campaign.principalId,
        campaign.id,
        (candidate) => {
          if (candidate.status !== 'applying') return false;
          const current = candidate.attempts.at(-1);
          if (
            current === undefined ||
            current.artifactId !== attempt.artifactId
          )
            return false;
          current.applicationId = application.id;
          candidate.updatedAt = now;
          return true;
        },
      );
    }
    if (
      application.status === 'awaiting_approval' &&
      application.approval.status === 'pending'
    ) {
      assertApplicationApproval(campaign, application);
      application = await options.applications.decideApproval({
        principalId: campaign.principalId,
        applicationId: application.id,
        decision: 'approved',
      });
    }
    if (['approved', 'applying'].includes(application.status)) {
      application = await options.applications.progress(
        campaign.principalId,
        application.id,
      );
    }
    if (
      ['awaiting_approval', 'approved', 'applying'].includes(application.status)
    )
      return campaign;
    if (application.status !== 'succeeded') {
      throw new DevelopmentCampaignOperationError(
        'The approved campaign patch could not be staged safely.',
        application.status === 'review_required'
          ? 'review_required'
          : 'campaign_conflict',
      );
    }
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (candidate.status !== 'applying') return false;
      candidate.status = 'verifying';
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_change_applied',
        now,
        { attempt: attempt.number, applicationId: application.id },
        createId,
      );
      return true;
    });
  }

  async function progressVerification(campaign: DevelopmentCampaign) {
    const attempt = campaign.attempts.at(-1);
    if (attempt?.applicationId === undefined)
      throw new Error('Campaign application is missing.');
    const application = await options.applications.get(
      campaign.principalId,
      attempt.applicationId,
    );
    const verification = await options.operations.verify({
      campaign,
      application,
    });
    const now = clock();
    if (verification.status === 'failed') {
      return update(campaign.principalId, campaign.id, (candidate) => {
        if (candidate.status !== 'verifying') return false;
        const current = candidate.attempts.at(-1);
        if (current?.applicationId !== application.id) return false;
        current.verification = verification;
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          'development_campaign_verification_failed',
          now,
          {
            attempt: current.number,
            failedGate: verification.gates.find(
              (gate) => gate.status === 'failed',
            )?.id,
          },
          createId,
        );
        if (current.number < candidate.approval.effect.limits.maxAttempts) {
          candidate.status = 'approved';
        } else {
          candidate.status = 'failed';
          candidate.failure = {
            code: 'verification_failed',
            message:
              'Configured quality gates failed after all approved repair attempts.',
          };
          appendEvent(
            candidate,
            'development_campaign_failed',
            now,
            { code: 'verification_failed' },
            createId,
          );
        }
        return true;
      });
    }
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (candidate.status !== 'verifying') return false;
      const current = candidate.attempts.at(-1);
      if (current?.applicationId !== application.id) return false;
      current.verification = verification;
      candidate.status = 'publishing';
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_verification_passed',
        now,
        {
          attempt: current.number,
          gates: verification.gates.map((gate) => gate.id),
        },
        createId,
      );
      appendEvent(
        candidate,
        'development_campaign_publication_started',
        now,
        { applicationId: application.id },
        createId,
      );
      return true;
    });
  }

  async function progressPublication(campaign: DevelopmentCampaign) {
    const applicationId = campaign.attempts.at(-1)?.applicationId;
    if (applicationId === undefined)
      throw new Error('Campaign application is missing.');
    let publication =
      campaign.publicationId === undefined
        ? await options.publications.create({
            principalId: campaign.principalId,
            requestKey: `development-campaign:${campaign.id}:publication`,
            applicationId,
            baseBranch: campaign.approval.effect.baseBranch,
            commitMessage: campaign.approval.effect.delivery.commitMessage,
            pullRequest: campaign.approval.effect.delivery.pullRequest,
          })
        : await options.publications.get(
            campaign.principalId,
            campaign.publicationId,
          );
    if (campaign.publicationId === undefined) {
      const now = clock();
      campaign = await update(
        campaign.principalId,
        campaign.id,
        (candidate) => {
          if (candidate.status !== 'publishing') return false;
          candidate.publicationId = publication.id;
          candidate.updatedAt = now;
          return true;
        },
      );
    }
    if (
      publication.status === 'awaiting_approval' &&
      publication.approval.status === 'pending'
    ) {
      assertPublicationApproval(campaign, publication);
      publication = await options.publications.decideApproval({
        principalId: campaign.principalId,
        publicationId: publication.id,
        decision: 'approved',
      });
    }
    if (['approved', 'publishing'].includes(publication.status)) {
      publication = await options.publications.progress(
        campaign.principalId,
        publication.id,
      );
    }
    if (
      ['awaiting_approval', 'approved', 'publishing'].includes(
        publication.status,
      )
    )
      return campaign;
    if (
      publication.status !== 'succeeded' ||
      publication.result === undefined
    ) {
      throw new DevelopmentCampaignOperationError(
        'The approved campaign pull request could not be published.',
        publication.status === 'review_required'
          ? 'review_required'
          : 'publication_failed',
      );
    }
    const publicationResult = publication.result;
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (candidate.status !== 'publishing') return false;
      candidate.status = 'observing';
      candidate.pullRequest = {
        number: publicationResult.pullRequest.number,
        url: publicationResult.pullRequest.url,
        headRevision: publicationResult.commitRevision,
      };
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_pull_request_created',
        now,
        {
          publicationId: publication.id,
          pullRequestNumber: publicationResult.pullRequest.number,
          pullRequestUrl: publicationResult.pullRequest.url,
        },
        createId,
      );
      return true;
    });
  }

  async function progressObservation(campaign: DevelopmentCampaign) {
    if (
      campaign.publicationId === undefined ||
      campaign.pullRequest === undefined
    )
      throw new Error('Campaign publication is missing.');
    const publication = await options.publications.get(
      campaign.principalId,
      campaign.publicationId,
    );
    const observation = await options.operations.observe({
      campaign,
      publication,
    });
    const effect = campaign.approval.effect;
    if (
      observation.headRevision !== campaign.pullRequest.headRevision ||
      observation.baseRevision !== effect.baseRevision ||
      observation.state !== 'OPEN'
    ) {
      throw new DevelopmentCampaignOperationError(
        'The pull request identity or base changed while the campaign was observing it.',
        'review_required',
      );
    }
    if (
      observation.checks.failed > 0 ||
      observation.reviewDecision === 'CHANGES_REQUESTED'
    ) {
      throw new DevelopmentCampaignOperationError(
        observation.checks.failed > 0
          ? 'One or more required pull-request checks failed.'
          : 'A reviewer requested changes on the campaign pull request.',
        observation.checks.failed > 0 ? 'checks_failed' : 'review_required',
      );
    }
    const ready =
      observation.checks.total >= effect.limits.minimumRequiredChecks &&
      observation.checks.pending === 0 &&
      observation.checks.failed === 0 &&
      (!effect.merge.requireReviewApproval ||
        observation.reviewDecision === 'APPROVED');
    const previous = campaign.pullRequest.observation;
    const semanticChanged =
      previous === undefined ||
      !stableEqual(
        { ...previous, checkedAt: undefined },
        { ...observation, checkedAt: undefined },
      );
    if (!ready && !semanticChanged) return campaign;
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (
        candidate.status !== 'observing' ||
        candidate.pullRequest === undefined
      )
        return false;
      candidate.pullRequest.observation = observation;
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_pull_request_observed',
        now,
        {
          checks: observation.checks,
          reviewDecision: observation.reviewDecision,
          mergeState: observation.mergeState,
        },
        createId,
      );
      if (ready) {
        candidate.status = 'merging';
        appendEvent(
          candidate,
          'development_campaign_merge_started',
          now,
          { pullRequestNumber: candidate.pullRequest.number },
          createId,
        );
      }
      return true;
    });
  }

  async function progressMerge(campaign: DevelopmentCampaign) {
    if (campaign.publicationId === undefined)
      throw new Error('Campaign publication is missing.');
    const publication = await options.publications.get(
      campaign.principalId,
      campaign.publicationId,
    );
    const project = await requireProject(campaign);
    const merged = await options.operations.merge({
      campaign,
      project,
      publication,
    });
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (candidate.status !== 'merging') return false;
      if (candidate.pullRequest === undefined) return false;
      candidate.mergeResult = merged;
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_merged',
        now,
        {
          mergeRevision: merged.mergeRevision,
          baseRevision: merged.baseRevision,
        },
        createId,
      );
      if (candidate.approval.effect.merge.synchronizeLocalBase) {
        candidate.status = 'synchronizing';
      } else {
        candidate.status = 'succeeded';
        candidate.result = {
          pullRequestNumber: candidate.pullRequest.number,
          pullRequestUrl: candidate.pullRequest.url,
          mergeRevision: merged.mergeRevision,
          baseRevision: merged.baseRevision,
          attempts: candidate.attempts.length,
          completedAt: now,
        };
        appendEvent(
          candidate,
          'development_campaign_succeeded',
          now,
          {},
          createId,
        );
      }
      return true;
    });
  }

  async function progressSynchronization(campaign: DevelopmentCampaign) {
    if (campaign.mergeResult === undefined)
      throw new Error('Campaign merge result is missing.');
    const project = await requireProject(campaign);
    const synchronized = await options.operations.synchronize({
      campaign,
      project,
      mergeRevision: campaign.mergeResult.mergeRevision,
      baseRevision: campaign.mergeResult.baseRevision,
    });
    const now = clock();
    return update(campaign.principalId, campaign.id, (candidate) => {
      if (
        candidate.status !== 'synchronizing' ||
        candidate.pullRequest === undefined ||
        candidate.mergeResult === undefined
      )
        return false;
      candidate.status = 'succeeded';
      candidate.result = {
        pullRequestNumber: candidate.pullRequest.number,
        pullRequestUrl: candidate.pullRequest.url,
        mergeRevision: candidate.mergeResult.mergeRevision,
        baseRevision: synchronized.baseRevision,
        attempts: candidate.attempts.length,
        completedAt: now,
      };
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        'development_campaign_synchronized',
        now,
        { baseRevision: synchronized.baseRevision },
        createId,
      );
      appendEvent(
        candidate,
        'development_campaign_succeeded',
        now,
        {},
        createId,
      );
      return true;
    });
  }

  return {
    async listPolicies(principalId) {
      return options.operations.listPolicies(
        await options.projects.listProjects(principalId),
      );
    },

    async create(input) {
      const existing = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        if (!requestMatches(existing, input)) {
          throw new DevelopmentCampaignError(
            `Idempotency key ${input.requestKey} belongs to another campaign request.`,
            'development_campaign_idempotency_key_reused',
          );
        }
        return existing;
      }
      const project = await options.projects.findProjectById(
        input.principalId,
        input.projectId,
      );
      if (project === null) {
        throw new DevelopmentCampaignError(
          `Project ${input.projectId} was not found.`,
          'development_campaign_project_not_found',
        );
      }
      const capabilities = (
        ['development_planning', 'software_change'] as const
      )
        .map((name) => {
          const runtime = options.capabilities.selected({ name, version: 1 });
          return runtime === null
            ? null
            : {
                name,
                version: 1 as const,
                destination: runtime.destination,
                authority: runtime.authority,
              };
        })
        .filter((capability) => capability !== null);
      if (
        !capabilities.some(
          (capability) => capability.name === 'software_change',
        )
      ) {
        throw new DevelopmentCampaignError(
          'The software-change capability is unavailable.',
          'development_campaign_capability_unavailable',
        );
      }
      const effect = await options.operations.prepare({
        project,
        policyId: input.policyId,
        objective: input.objective.trim(),
        ticket: {
          reference: input.ticket.reference.trim(),
          details: input.ticket.details.trim(),
        },
        delivery: {
          commitMessage: input.delivery.commitMessage.trim(),
          pullRequest: {
            title: input.delivery.pullRequest.title.trim(),
            body: input.delivery.pullRequest.body,
            draft: false,
          },
        },
        capabilities,
      });
      const now = clock();
      const approvalId = createId('approval');
      const campaign = DevelopmentCampaignSchema.parse({
        schemaVersion: 1,
        version: 1,
        id: createId('campaign'),
        requestKey: input.requestKey,
        principalId: input.principalId,
        status: 'awaiting_approval',
        approval: {
          id: approvalId,
          status: 'pending',
          reason: 'development_campaign',
          effect,
          requestedAt: now,
        },
        attempts: [],
        events: [
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 1,
            type: 'development_campaign_created',
            occurredAt: now,
            data: { projectId: project.id, policyId: effect.policyId },
          },
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 2,
            type: 'development_campaign_approval_requested',
            occurredAt: now,
            data: {
              approvalId,
              repository: `${effect.repository.owner}/${effect.repository.name}`,
              baseRevision: effect.baseRevision,
              maxAttempts: effect.limits.maxAttempts,
            },
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      const created = await options.store.create(campaign);
      if (!created.created && !requestMatches(created.campaign, input)) {
        throw new DevelopmentCampaignError(
          `Idempotency key ${input.requestKey} belongs to another campaign request.`,
          'development_campaign_idempotency_key_reused',
        );
      }
      return created.campaign;
    },

    get: requireCampaign,

    list: (principalId) => options.store.list(principalId, 50),

    async decideApproval(input) {
      const now = clock();
      return update(input.principalId, input.campaignId, (candidate) => {
        if (candidate.approval.status !== 'pending') {
          if (
            candidate.approval.status === input.decision &&
            candidate.approval.decidedBy === input.principalId
          )
            return false;
          throw new DevelopmentCampaignError(
            `Approval ${candidate.approval.id} has already been decided.`,
            'development_campaign_approval_already_decided',
          );
        }
        candidate.approval.status = input.decision;
        candidate.approval.decidedAt = now;
        candidate.approval.decidedBy = input.principalId;
        candidate.status =
          input.decision === 'approved' ? 'approved' : 'rejected';
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          input.decision === 'approved'
            ? 'development_campaign_approval_approved'
            : 'development_campaign_approval_rejected',
          now,
          { approvalId: candidate.approval.id },
          createId,
        );
        return true;
      });
    },

    async cancel(input) {
      const campaign = await requireCampaign(
        input.principalId,
        input.campaignId,
      );
      if (
        ![
          'awaiting_approval',
          'approved',
          'implementing',
          'applying',
          'verifying',
        ].includes(campaign.status)
      ) {
        throw new DevelopmentCampaignError(
          `Campaign ${campaign.id} can no longer be cancelled safely.`,
          'development_campaign_not_cancellable',
        );
      }
      const attempt = campaign.attempts.at(-1);
      if (campaign.status === 'implementing' && attempt !== undefined) {
        await options.tasks.cancelRun({
          principalId: campaign.principalId,
          runId: attempt.runId,
        });
      }
      if (
        campaign.status === 'applying' &&
        attempt?.applicationId !== undefined
      ) {
        await options.applications.cancel({
          principalId: campaign.principalId,
          applicationId: attempt.applicationId,
        });
      }
      const now = clock();
      return update(input.principalId, input.campaignId, (candidate) => {
        if (
          ![
            'awaiting_approval',
            'approved',
            'implementing',
            'applying',
            'verifying',
          ].includes(candidate.status)
        )
          return false;
        candidate.status = 'cancelled';
        candidate.failure = {
          code: 'cancelled',
          message: 'The owner cancelled the campaign before publication.',
        };
        if (candidate.approval.status === 'pending') {
          candidate.approval.status = 'rejected';
          candidate.approval.decidedAt = now;
          candidate.approval.decidedBy = input.principalId;
        }
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          'development_campaign_cancelled',
          now,
          {},
          createId,
        );
        return true;
      });
    },

    async progress(principalId, campaignId) {
      let campaign = await requireCampaign(principalId, campaignId);
      if (
        [
          'succeeded',
          'rejected',
          'failed',
          'review_required',
          'cancelled',
        ].includes(campaign.status)
      )
        return campaign;
      const expiresAt =
        new Date(campaign.createdAt).getTime() +
        campaign.approval.effect.limits.maxDurationMinutes * 60_000;
      if (
        new Date(clock()).getTime() > expiresAt &&
        campaign.status !== 'merging' &&
        campaign.status !== 'synchronizing'
      ) {
        const now = clock();
        return update(principalId, campaignId, (candidate) => {
          candidate.status = 'failed';
          candidate.failure = {
            code: 'campaign_expired',
            message:
              'The approved campaign duration elapsed before merge began.',
          };
          candidate.updatedAt = now;
          appendEvent(
            candidate,
            'development_campaign_failed',
            now,
            { code: 'campaign_expired' },
            createId,
          );
          return true;
        });
      }
      try {
        switch (campaign.status) {
          case 'awaiting_approval':
            return campaign;
          case 'approved':
            return await progressApproved(campaign);
          case 'implementing':
            return await progressImplementation(campaign);
          case 'applying':
            return await progressApplication(campaign);
          case 'verifying':
            return await progressVerification(campaign);
          case 'publishing':
            return await progressPublication(campaign);
          case 'observing':
            return await progressObservation(campaign);
          case 'merging':
            return await progressMerge(campaign);
          case 'synchronizing':
            return await progressSynchronization(campaign);
          default:
            return campaign;
        }
      } catch (error) {
        campaign = await requireCampaign(principalId, campaignId);
        return fail(campaign, error);
      }
    },
  };
}
