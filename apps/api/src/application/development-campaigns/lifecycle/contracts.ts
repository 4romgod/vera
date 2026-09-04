import {
  type DevelopmentCampaign,
  type DevelopmentCampaignEffect,
} from '../../../domain/development-campaigns/development-campaign.ts';
import type { SoftwareChangeApplicationLifecycle } from '../../change-applications/software-change-application-lifecycle.ts';
import type { SoftwareChangePublicationLifecycle } from '../../change-applications/software-change-publication-lifecycle.ts';
import type { TaskLifecycle } from '../../tasks/task-lifecycle.ts';
import type { CapabilityRuntimeRegistry } from '../../../ports/capabilities/capability-runtime.ts';
import type { DevelopmentCampaignOperations } from '../../../ports/development-campaigns/development-campaign-operations.ts';
import type { DevelopmentCampaignStore } from '../../../ports/persistence/development-campaign-store.ts';
import type { ProjectStore } from '../../../ports/persistence/project-store.ts';

export type DevelopmentCampaignErrorCode =
  | 'development_campaign_not_found'
  | 'development_campaign_idempotency_key_reused'
  | 'development_campaign_project_not_found'
  | 'development_campaign_capability_unavailable'
  | 'development_campaign_approval_already_decided'
  | 'development_campaign_approval_managed_by_mission'
  | 'development_campaign_repair_not_available'
  | 'development_campaign_repair_not_found'
  | 'development_campaign_repair_already_decided'
  | 'development_campaign_repair_conflict'
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

export type Clock = () => string;
export type IdFactory = (prefix: string) => string;

export type DevelopmentCampaignLifecycleOptions = {
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
};

export type DevelopmentCampaignLifecycle = {
  listPolicies(
    principalId: string,
  ): Promise<
    import('../../../domain/development-campaigns/development-campaign.ts').DevelopmentCampaignPolicySummary[]
  >;
  create(input: {
    principalId: string;
    requestKey: string;
    projectId: string;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: DevelopmentCampaignEffect['delivery'];
    completionMode?: 'policy' | 'pull_request_only';
    approvalController?: DevelopmentCampaignEffect['approvalController'];
  }): Promise<DevelopmentCampaign>;
  get(principalId: string, campaignId: string): Promise<DevelopmentCampaign>;
  list(principalId: string): Promise<DevelopmentCampaign[]>;
  decideApproval(input: {
    principalId: string;
    campaignId: string;
    decision: 'approved' | 'rejected';
  }): Promise<DevelopmentCampaign>;
  decideMissionApproval(input: {
    principalId: string;
    campaignId: string;
    missionId: string;
    decision: 'approved' | 'rejected';
  }): Promise<DevelopmentCampaign>;
  requestRepair(input: {
    principalId: string;
    campaignId: string;
    requestKey: string;
  }): Promise<DevelopmentCampaign>;
  decideRepair(input: {
    principalId: string;
    campaignId: string;
    repairId: string;
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
