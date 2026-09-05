import type {
  ChangeApplicationResource,
  ChangeApplicationEventsResource,
  ChangeApplicationListResource,
  SoftwareChangePublicationResource,
  SoftwareChangePublicationEventsResource,
  SoftwareChangePublicationListResource,
} from '../generated/types.gen.ts';
import type {
  ChangeApplicationStatus,
  SoftwareChangePublicationStatus,
  WaitForChangeApplicationOptions,
  WaitForSoftwareChangePublicationOptions,
} from '../sdk-types.ts';
import {
  getV1ArtifactsIdApplications,
  getV1ChangeApplicationsId,
  getV1ChangeApplicationsIdEvents,
  getV1ChangeApplicationsIdPublications,
  getV1DevelopmentCampaignPolicies,
  getV1DevelopmentCampaigns,
  getV1DevelopmentCampaignsId,
  getV1SoftwareChangePublicationsId,
  getV1SoftwareChangePublicationsIdEvents,
  postV1ArtifactsIdApplications,
  postV1ChangeApplicationsIdCancellation,
  postV1ChangeApplicationsIdDecision,
  postV1ChangeApplicationsIdPublications,
  postV1DevelopmentCampaigns,
  postV1DevelopmentCampaignsIdCancellation,
  postV1DevelopmentCampaignsIdDecision,
  postV1DevelopmentCampaignsIdRepairs,
  postV1DevelopmentCampaignsIdRepairsRepairIdDecision,
  postV1SoftwareChangePublicationsIdCancellation,
  postV1SoftwareChangePublicationsIdDecision,
} from '../generated/sdk.gen.ts';
import { OwnerDataClient } from './owner-data-client.ts';
import { delay } from '../http/transport.ts';

export class SoftwareDeliveryClient extends OwnerDataClient {
  public createChangeApplication(input: {
    artifactId: string;
    idempotencyKey: string;
  }): Promise<ChangeApplicationResource> {
    return this.generatedRequest(
      postV1ArtifactsIdApplications({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        path: { id: input.artifactId },
      }),
    );
  }

  public async listChangeApplicationsForArtifact(
    artifactId: string,
  ): Promise<ChangeApplicationListResource> {
    return this.generatedRequest(
      getV1ArtifactsIdApplications({
        client: this.generatedClient,
        path: { id: artifactId },
      }),
    );
  }

  public getChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource> {
    return this.generatedRequest(
      getV1ChangeApplicationsId({
        client: this.generatedClient,
        path: { id: applicationId },
      }),
    );
  }

  public getChangeApplicationEvents(
    applicationId: string,
  ): Promise<ChangeApplicationEventsResource> {
    return this.generatedRequest(
      getV1ChangeApplicationsIdEvents({
        client: this.generatedClient,
        path: { id: applicationId },
      }),
    );
  }

  public decideChangeApplication(input: {
    applicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<ChangeApplicationResource> {
    return this.generatedRequest(
      postV1ChangeApplicationsIdDecision({
        client: this.generatedClient,
        path: { id: input.applicationId },
        body: { decision: input.decision },
      }),
    );
  }

  public cancelChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource> {
    return this.generatedRequest(
      postV1ChangeApplicationsIdCancellation({
        client: this.generatedClient,
        path: { id: applicationId },
      }),
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
        application = await this.generatedRequest(
          getV1ChangeApplicationsId({
            client: this.generatedClient,
            path: { id: applicationId },
            signal,
          }),
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
    return this.generatedRequest(
      postV1ChangeApplicationsIdPublications({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        path: { id: input.applicationId },
        body: {
          baseBranch: input.baseBranch,
          commitMessage: input.commitMessage,
          pullRequest: input.pullRequest,
        },
      }),
    );
  }

  public async listSoftwareChangePublicationsForApplication(
    applicationId: string,
  ): Promise<SoftwareChangePublicationListResource> {
    return this.generatedRequest(
      getV1ChangeApplicationsIdPublications({
        client: this.generatedClient,
        path: { id: applicationId },
      }),
    );
  }

  public getSoftwareChangePublication(publicationId: string) {
    return this.generatedRequest(
      getV1SoftwareChangePublicationsId({
        client: this.generatedClient,
        path: { id: publicationId },
      }),
    );
  }

  public getSoftwareChangePublicationEvents(
    publicationId: string,
  ): Promise<SoftwareChangePublicationEventsResource> {
    return this.generatedRequest(
      getV1SoftwareChangePublicationsIdEvents({
        client: this.generatedClient,
        path: { id: publicationId },
      }),
    );
  }

  public decideSoftwareChangePublication(input: {
    publicationId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.generatedRequest(
      postV1SoftwareChangePublicationsIdDecision({
        client: this.generatedClient,
        path: { id: input.publicationId },
        body: { decision: input.decision },
      }),
    );
  }

  public cancelSoftwareChangePublication(publicationId: string) {
    return this.generatedRequest(
      postV1SoftwareChangePublicationsIdCancellation({
        client: this.generatedClient,
        path: { id: publicationId },
      }),
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
    return this.generatedRequest(
      postV1DevelopmentCampaigns({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          projectId: input.projectId,
          policyId: input.policyId,
          objective: input.objective,
          ticket: input.ticket,
          delivery: input.delivery,
        },
      }),
    );
  }

  public async listDevelopmentCampaignPolicies() {
    return this.generatedRequest(
      getV1DevelopmentCampaignPolicies({
        client: this.generatedClient,
      }),
    );
  }

  public async listDevelopmentCampaigns() {
    return this.generatedRequest(
      getV1DevelopmentCampaigns({ client: this.generatedClient }),
    );
  }

  public getDevelopmentCampaign(campaignId: string) {
    return this.generatedRequest(
      getV1DevelopmentCampaignsId({
        client: this.generatedClient,
        path: { id: campaignId },
      }),
    );
  }

  public decideDevelopmentCampaign(input: {
    campaignId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.generatedRequest(
      postV1DevelopmentCampaignsIdDecision({
        client: this.generatedClient,
        path: { id: input.campaignId },
        body: { decision: input.decision },
      }),
    );
  }

  public requestDevelopmentCampaignRepair(input: {
    campaignId: string;
    idempotencyKey: string;
  }) {
    return this.generatedRequest(
      postV1DevelopmentCampaignsIdRepairs({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        path: { id: input.campaignId },
      }),
    );
  }

  public decideDevelopmentCampaignRepair(input: {
    campaignId: string;
    repairId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.generatedRequest(
      postV1DevelopmentCampaignsIdRepairsRepairIdDecision({
        client: this.generatedClient,
        path: { id: input.campaignId, repairId: input.repairId },
        body: { decision: input.decision },
      }),
    );
  }

  public cancelDevelopmentCampaign(campaignId: string) {
    return this.generatedRequest(
      postV1DevelopmentCampaignsIdCancellation({
        client: this.generatedClient,
        path: { id: campaignId },
      }),
    );
  }
}
