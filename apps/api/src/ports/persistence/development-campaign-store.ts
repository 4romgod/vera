import type { DevelopmentCampaign } from '../../domain/development-campaigns/development-campaign.ts';

export type DevelopmentCampaignStore = {
  create(campaign: DevelopmentCampaign): Promise<{
    created: boolean;
    campaign: DevelopmentCampaign;
  }>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<DevelopmentCampaign | null>;
  findById(
    principalId: string,
    campaignId: string,
  ): Promise<DevelopmentCampaign | null>;
  list(principalId: string, limit: number): Promise<DevelopmentCampaign[]>;
  replace(
    campaign: DevelopmentCampaign,
    expectedVersion: number,
  ): Promise<boolean>;
  findDispatchable(limit: number): Promise<DevelopmentCampaign[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
