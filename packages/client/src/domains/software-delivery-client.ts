import type {
  ChangeApplicationStatus,
  ChangeApplicationResource,
  ChangeApplicationEventsResource,
  ChangeApplicationListResource,
  SoftwareChangePublicationStatus,
  SoftwareChangePublicationResource,
  SoftwareChangePublicationEventsResource,
  SoftwareChangePublicationListResource,
  WaitForChangeApplicationOptions,
  WaitForSoftwareChangePublicationOptions,
} from '../contracts/index.ts';
import {
  assertChangeApplicationListResource,
  assertSoftwareChangePublicationListResource,
  assertDevelopmentCampaignListResource,
  assertDevelopmentCampaignPolicyListResource,
} from '../validation/index.ts';
import { OwnerDataClient } from './owner-data-client.ts';
import { delay } from '../http/transport.ts';

export class SoftwareDeliveryClient extends OwnerDataClient {
  public createChangeApplication(input: {
    artifactId: string;
    idempotencyKey: string;
  }): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/artifacts/${encodeURIComponent(input.artifactId)}/applications`,
      { method: 'POST', idempotencyKey: input.idempotencyKey },
    );
  }

  public async listChangeApplicationsForArtifact(
    artifactId: string,
  ): Promise<ChangeApplicationListResource> {
    const value: unknown = await this.request(
      `/v1/artifacts/${encodeURIComponent(artifactId)}/applications`,
    );
    assertChangeApplicationListResource(value);
    return value;
  }

  public getChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/change-applications/${encodeURIComponent(applicationId)}`,
    );
  }

  public getChangeApplicationEvents(
    applicationId: string,
  ): Promise<ChangeApplicationEventsResource> {
    return this.request(
      `/v1/change-applications/${encodeURIComponent(applicationId)}/events`,
    );
  }

  public decideChangeApplication(input: {
    applicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/change-applications/${encodeURIComponent(input.applicationId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/change-applications/${encodeURIComponent(applicationId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public async waitForChangeApplication(
    applicationId: string,
    options?: WaitForChangeApplicationOptions,
  ): Promise<ChangeApplicationResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 600_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        'waitForChangeApplication timeoutMs must be a positive number.',
      );
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        'waitForChangeApplication intervalMs must be a positive number.',
      );
    }
    const terminal = new Set<ChangeApplicationStatus>([
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(
          `Timed out waiting for change application ${applicationId}.`,
        );
      }
      const timeoutSignal = AbortSignal.timeout(
        Math.max(1, timeoutMs - elapsedMs),
      );
      const signal =
        options?.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      let application: ChangeApplicationResource;
      try {
        application = await this.changeApplicationRequest(
          `/v1/change-applications/${encodeURIComponent(applicationId)}`,
          { signal },
        );
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        if (timeoutSignal.aborted) {
          throw new Error(
            `Timed out waiting for change application ${applicationId}.`,
            { cause: error },
          );
        }
        throw error;
      }
      options?.onUpdate?.(application);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(
          application,
        )
      ) {
        return application;
      }
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public createSoftwareChangePublication(input: {
    applicationId: string;
    baseBranch: string;
    commitMessage: string;
    pullRequest: { title: string; body: string; draft: boolean };
    idempotencyKey: string;
  }): Promise<SoftwareChangePublicationResource> {
    return this.softwareChangePublicationRequest(
      `/v1/change-applications/${encodeURIComponent(input.applicationId)}/publications`,
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        body: {
          baseBranch: input.baseBranch,
          commitMessage: input.commitMessage,
          pullRequest: input.pullRequest,
        },
      },
    );
  }

  public async listSoftwareChangePublicationsForApplication(
    applicationId: string,
  ): Promise<SoftwareChangePublicationListResource> {
    const value: unknown = await this.request(
      `/v1/change-applications/${encodeURIComponent(applicationId)}/publications`,
    );
    assertSoftwareChangePublicationListResource(value);
    return value;
  }

  public getSoftwareChangePublication(publicationId: string) {
    return this.softwareChangePublicationRequest(
      `/v1/software-change-publications/${encodeURIComponent(publicationId)}`,
    );
  }

  public getSoftwareChangePublicationEvents(
    publicationId: string,
  ): Promise<SoftwareChangePublicationEventsResource> {
    return this.request(
      `/v1/software-change-publications/${encodeURIComponent(publicationId)}/events`,
    );
  }

  public decideSoftwareChangePublication(input: {
    publicationId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.softwareChangePublicationRequest(
      `/v1/software-change-publications/${encodeURIComponent(input.publicationId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelSoftwareChangePublication(publicationId: string) {
    return this.softwareChangePublicationRequest(
      `/v1/software-change-publications/${encodeURIComponent(publicationId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public async waitForSoftwareChangePublication(
    publicationId: string,
    options?: WaitForSoftwareChangePublicationOptions,
  ): Promise<SoftwareChangePublicationResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 600_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        'waitForSoftwareChangePublication timeoutMs must be a positive number.',
      );
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        'waitForSoftwareChangePublication intervalMs must be a positive number.',
      );
    }
    const terminal = new Set<SoftwareChangePublicationStatus>([
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(`Timed out waiting for publication ${publicationId}.`);
      }
      const publication =
        await this.getSoftwareChangePublication(publicationId);
      options?.onUpdate?.(publication);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(
          publication,
        )
      ) {
        return publication;
      }
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public createDevelopmentCampaign(input: {
    projectId: string;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: {
      commitMessage: string;
      pullRequest: { title: string; body: string; draft: false };
    };
    idempotencyKey: string;
  }) {
    return this.developmentCampaignRequest('/v1/development-campaigns', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        projectId: input.projectId,
        policyId: input.policyId,
        objective: input.objective,
        ticket: input.ticket,
        delivery: input.delivery,
      },
    });
  }

  public async listDevelopmentCampaignPolicies() {
    const value: unknown = await this.request(
      '/v1/development-campaign-policies',
    );
    assertDevelopmentCampaignPolicyListResource(value);
    return value;
  }

  public async listDevelopmentCampaigns() {
    const value: unknown = await this.request('/v1/development-campaigns');
    assertDevelopmentCampaignListResource(value);
    return value;
  }

  public getDevelopmentCampaign(campaignId: string) {
    return this.developmentCampaignRequest(
      `/v1/development-campaigns/${encodeURIComponent(campaignId)}`,
    );
  }

  public decideDevelopmentCampaign(input: {
    campaignId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.developmentCampaignRequest(
      `/v1/development-campaigns/${encodeURIComponent(input.campaignId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelDevelopmentCampaign(campaignId: string) {
    return this.developmentCampaignRequest(
      `/v1/development-campaigns/${encodeURIComponent(campaignId)}/cancellation`,
      { method: 'POST' },
    );
  }
}
