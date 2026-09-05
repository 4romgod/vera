import type {
  TaskResource,
  RoutineResource,
  RoutineRunResource,
} from '../generated/types.gen.ts';
import type {
  RunStatus,
  DevelopmentCampaignStatus,
  MissionStatus,
  RoutineScheduleResource,
  WaitForRoutineRunOptions,
  WaitForRunOptions,
  WaitForDevelopmentCampaignOptions,
  WaitForMissionOptions,
} from '../sdk-types.ts';
import {
  getV1MissionPolicies,
  getV1Missions,
  getV1MissionsId,
  getV1RoutineRunsId,
  getV1Routines,
  getV1RoutinesIdRuns,
  getV1RunsId,
  postV1Missions,
  postV1MissionsIdCancellation,
  postV1MissionsIdDecision,
  postV1Routines,
  postV1RoutinesIdDecision,
  postV1RoutinesIdPause,
  postV1RoutinesIdResume,
  postV1RoutinesIdRuns,
} from '../generated/sdk.gen.ts';
import { SoftwareDeliveryClient } from './software-delivery-client.ts';
import { delay } from '../http/transport.ts';

export class AutomationClient extends SoftwareDeliveryClient {
  public async listMissionPolicies() {
    return this.generatedRequest(
      getV1MissionPolicies({ client: this.generatedClient }),
    );
  }

  public async listMissions() {
    return this.generatedRequest(
      getV1Missions({ client: this.generatedClient }),
    );
  }

  public async listRoutines() {
    return this.generatedRequest(
      getV1Routines({ client: this.generatedClient }),
    );
  }

  public async createRoutine(input: {
    title: string;
    schedule: RoutineScheduleResource;
    action: RoutineResource['approval']['effect']['action'];
    idempotencyKey: string;
  }) {
    return this.generatedRequest(
      postV1Routines({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          title: input.title,
          schedule: input.schedule,
          action: input.action,
        },
      }),
    );
  }

  public decideRoutine(input: {
    routineId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.generatedRequest(
      postV1RoutinesIdDecision({
        client: this.generatedClient,
        path: { id: input.routineId },
        body: { decision: input.decision },
      }),
    );
  }

  public pauseRoutine(routineId: string) {
    return this.generatedRequest(
      postV1RoutinesIdPause({
        client: this.generatedClient,
        path: { id: routineId },
      }),
    );
  }

  public resumeRoutine(routineId: string) {
    return this.generatedRequest(
      postV1RoutinesIdResume({
        client: this.generatedClient,
        path: { id: routineId },
      }),
    );
  }

  public async runRoutineNow(input: {
    routineId: string;
    idempotencyKey: string;
  }) {
    return this.generatedRequest(
      postV1RoutinesIdRuns({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        path: { id: input.routineId },
      }),
    );
  }

  public async listRoutineRuns(routineId: string) {
    return this.generatedRequest(
      getV1RoutinesIdRuns({
        client: this.generatedClient,
        path: { id: routineId },
      }),
    );
  }

  public async getRoutineRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ) {
    return this.generatedRequest(
      getV1RoutineRunsId({
        client: this.generatedClient,
        path: { id: runId },
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  public async waitForRoutineRun(
    runId: string,
    options?: WaitForRoutineRunOptions,
  ): Promise<RoutineRunResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 120_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error('waitForRoutineRun timeoutMs must be a positive number.');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
      throw new Error(
        'waitForRoutineRun intervalMs must be a positive number.',
      );
    const terminal = new Set<RoutineRunResource['status']>([
      'succeeded',
      'failed',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs)
        throw new Error(`Timed out waiting for routine run ${runId}.`);
      const timeoutSignal = AbortSignal.timeout(
        Math.max(1, timeoutMs - elapsedMs),
      );
      const signal =
        options?.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      let run: RoutineRunResource;
      try {
        run = await this.getRoutineRun(runId, { signal });
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        if (timeoutSignal.aborted)
          throw new Error(`Timed out waiting for routine run ${runId}.`, {
            cause: error,
          });
        throw error;
      }
      options?.onUpdate?.(run);
      if ((options?.until ?? ((current) => terminal.has(current.status)))(run))
        return run;
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public createMission(input: {
    projectId: string;
    policyId: string;
    objective: string;
    completionCriteria: string;
    delivery: { commitMessage: string; pullRequestTitle: string };
    idempotencyKey: string;
  }) {
    return this.generatedRequest(
      postV1Missions({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          action: 'create',
          projectId: input.projectId,
          policyId: input.policyId,
          objective: input.objective,
          completionCriteria: input.completionCriteria,
          delivery: input.delivery,
        },
      }),
    );
  }

  public getMission(missionId: string) {
    return this.generatedRequest(
      getV1MissionsId({
        client: this.generatedClient,
        path: { id: missionId },
      }),
    );
  }

  public decideMission(input: {
    missionId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.generatedRequest(
      postV1MissionsIdDecision({
        client: this.generatedClient,
        path: { id: input.missionId },
        body: { decision: input.decision },
      }),
    );
  }

  public cancelMission(missionId: string) {
    return this.generatedRequest(
      postV1MissionsIdCancellation({
        client: this.generatedClient,
        path: { id: missionId },
      }),
    );
  }

  public async waitForMission(
    missionId: string,
    options?: WaitForMissionOptions,
  ) {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 4 * 60 * 60_000;
    const intervalMs = options?.intervalMs ?? 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('waitForMission timeoutMs must be positive.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('waitForMission intervalMs must be positive.');
    }
    const terminal = new Set<MissionStatus>([
      'succeeded',
      'rejected',
      'review_required',
      'failed',
      'cancelled',
    ]);
    for (;;) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for mission ${missionId}.`);
      }
      const mission = await this.getMission(missionId);
      options?.onUpdate?.(mission);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(mission)
      )
        return mission;
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public async waitForDevelopmentCampaign(
    campaignId: string,
    options?: WaitForDevelopmentCampaignOptions,
  ) {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 4 * 60 * 60_000;
    const intervalMs = options?.intervalMs ?? 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('waitForDevelopmentCampaign timeoutMs must be positive.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        'waitForDevelopmentCampaign intervalMs must be positive.',
      );
    }
    const terminal = new Set<DevelopmentCampaignStatus>([
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]);
    for (;;) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for campaign ${campaignId}.`);
      }
      const campaign = await this.getDevelopmentCampaign(campaignId);
      options?.onUpdate?.(campaign);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(
          campaign,
        )
      )
        return campaign;
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public async waitForRun(
    runId: string,
    options?: WaitForRunOptions,
  ): Promise<TaskResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 600_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('waitForRun timeoutMs must be a positive number.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('waitForRun intervalMs must be a positive number.');
    }
    const terminal = new Set<RunStatus>([
      'succeeded',
      'rejected',
      'failed',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(`Timed out waiting for run ${runId}.`);
      }
      const timeoutSignal = AbortSignal.timeout(
        Math.max(1, timeoutMs - elapsedMs),
      );
      const signal =
        options?.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      let task: TaskResource;
      try {
        task = await this.generatedRequest(
          getV1RunsId({
            client: this.generatedClient,
            path: { id: runId },
            signal,
          }),
        );
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        if (timeoutSignal.aborted) {
          throw new Error(`Timed out waiting for run ${runId}.`, {
            cause: error,
          });
        }
        throw error;
      }
      options?.onUpdate?.(task);
      if (
        (
          options?.until ??
          ((current) =>
            terminal.has(current.runStatus) &&
            (current.conversationId === undefined ||
              current.conversationReply?.status === 'projected'))
        )(task)
      ) {
        return task;
      }
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }
}
