import type { SoftwareChangeApplication } from '../../domain/changes/software-change-application.ts';
import type { SoftwareChangePublication } from '../../domain/changes/software-change-publication.ts';
import type {
  DevelopmentCampaign,
  DevelopmentCampaignCatalog,
  DevelopmentCampaignEffect,
  DevelopmentCampaignRepair,
  DevelopmentCampaignPolicySummary,
  PullRequestObservation,
} from '../../domain/development-campaigns/development-campaign.ts';
import type { Project } from '../../domain/projects/project.ts';

export class DevelopmentCampaignOperationError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | 'campaign_conflict'
      | 'verification_failed'
      | 'publication_failed'
      | 'checks_failed'
      | 'review_required'
      | 'merge_failed'
      | 'synchronization_failed',
  ) {
    super(message);
    this.name = 'DevelopmentCampaignOperationError';
  }
}

export type DevelopmentCampaignOperations = {
  readonly adapterId: 'local_git_github';
  listPolicies(projects: Project[]): DevelopmentCampaignPolicySummary[];
  prepare(input: {
    project: Project;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: DevelopmentCampaignEffect['delivery'];
    capabilities: DevelopmentCampaignEffect['capabilities'];
    completionMode?: 'policy' | 'pull_request_only';
    approvalController?: DevelopmentCampaignEffect['approvalController'];
  }): Promise<DevelopmentCampaignEffect>;
  assertProjectBase(input: {
    project: Project;
    effect: DevelopmentCampaignEffect;
  }): Promise<void>;
  verify(input: {
    campaign: DevelopmentCampaign;
    application: SoftwareChangeApplication;
  }): Promise<
    NonNullable<DevelopmentCampaign['attempts'][number]['verification']>
  >;
  observe(input: {
    campaign: DevelopmentCampaign;
    publication: SoftwareChangePublication;
  }): Promise<PullRequestObservation>;
  updatePullRequest(input: {
    campaign: DevelopmentCampaign;
    repair: DevelopmentCampaignRepair;
    application: SoftwareChangeApplication;
    publication: SoftwareChangePublication;
  }): Promise<{ headRevision: string; previousRevision: string }>;
  merge(input: {
    campaign: DevelopmentCampaign;
    project: Project;
    publication: SoftwareChangePublication;
  }): Promise<{
    mergeRevision: string;
    baseRevision: string;
    mergedAt: string;
  }>;
  synchronize(input: {
    campaign: DevelopmentCampaign;
    project: Project;
    mergeRevision: string;
    baseRevision: string;
  }): Promise<{ baseRevision: string; synchronizedAt: string }>;
  checkReadiness(): Promise<void>;
};

export type DevelopmentCampaignPolicyCatalog = DevelopmentCampaignCatalog;
