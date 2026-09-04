import type { DevelopmentCampaign } from '../../../../domain/development-campaigns/development-campaign.ts';
import type { DevelopmentCampaignStore } from '../../../../ports/persistence/development-campaign-store.ts';

export class InMemoryDevelopmentCampaignStore
  implements DevelopmentCampaignStore
{
  private readonly campaigns = new Map<string, DevelopmentCampaign>();
  private readonly idByRequest = new Map<string, string>();

  public create(campaign: DevelopmentCampaign) {
    const identity = `${campaign.principalId}\u0000${campaign.requestKey}`;
    const existingId = this.idByRequest.get(identity);
    if (existingId !== undefined) {
      const existing = this.campaigns.get(existingId);
      if (existing === undefined)
        throw new Error('Campaign index is inconsistent.');
      return Promise.resolve({
        created: false,
        campaign: structuredClone(existing),
      });
    }
    this.idByRequest.set(identity, campaign.id);
    this.campaigns.set(campaign.id, structuredClone(campaign));
    return Promise.resolve({
      created: true,
      campaign: structuredClone(campaign),
    });
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const id = this.idByRequest.get(`${principalId}\u0000${requestKey}`);
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public findById(principalId: string, campaignId: string) {
    const campaign = this.campaigns.get(campaignId);
    return Promise.resolve(
      campaign?.principalId === principalId ? structuredClone(campaign) : null,
    );
  }

  public list(principalId: string, limit: number) {
    return Promise.resolve(
      [...this.campaigns.values()]
        .filter((campaign) => campaign.principalId === principalId)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, limit)
        .map((campaign) => structuredClone(campaign)),
    );
  }

  public replace(campaign: DevelopmentCampaign, expectedVersion: number) {
    const existing = this.campaigns.get(campaign.id);
    if (existing?.version !== expectedVersion) return Promise.resolve(false);
    this.campaigns.set(campaign.id, structuredClone(campaign));
    return Promise.resolve(true);
  }

  public findDispatchable(limit: number) {
    return Promise.resolve(
      [...this.campaigns.values()]
        .filter((campaign) =>
          [
            'approved',
            'implementing',
            'applying',
            'verifying',
            'publishing',
            'observing',
            'repairing',
            'merging',
            'synchronizing',
          ].includes(campaign.status),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((campaign) => structuredClone(campaign)),
    );
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.campaigns.clear();
    this.idByRequest.clear();
    return Promise.resolve();
  }
}
