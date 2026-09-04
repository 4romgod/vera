import type {
  RunStatus,
  TaskResource,
  DevelopmentCampaignStatus,
  MissionStatus,
  RoutineScheduleResource,
  RoutineResource,
  RoutineRunResource,
  WaitForRoutineRunOptions,
  WaitForRunOptions,
  WaitForDevelopmentCampaignOptions,
  WaitForMissionOptions,
} from '../contracts/index.ts';
import {
  isRecord,
  assertMissionListResource,
  assertMissionPolicyListResource,
  assertRoutineResource,
  assertRoutineRunResource,
} from '../validation/index.ts';
import { SoftwareDeliveryClient } from './software-delivery-client.ts';
import { delay } from '../http/transport.ts';

export class AutomationClient extends SoftwareDeliveryClient {
  public async listMissionPolicies() {
    const value: unknown = await this.request('/v1/mission-policies');
    assertMissionPolicyListResource(value);
    return value;
  }

  public async listMissions() {
    const value: unknown = await this.request('/v1/missions');
    assertMissionListResource(value);
    return value;
  }

  public async listRoutines() {
    const value: unknown = await this.request('/v1/routines');
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.routines)
    )
      throw new Error('Vera returned an invalid routine list.');
    for (const routine of value.routines) assertRoutineResource(routine);
    return value as { schemaVersion: 1; routines: RoutineResource[] };
  }

  public async createRoutine(input: {
    title: string;
    schedule: RoutineScheduleResource;
    action: RoutineResource['approval']['effect']['action'];
    idempotencyKey: string;
  }) {
    return this.routineRequest('/v1/routines', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        title: input.title,
        schedule: input.schedule,
        action: input.action,
      },
    });
  }

  public decideRoutine(input: {
    routineId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.routineRequest(
      `/v1/routines/${encodeURIComponent(input.routineId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public pauseRoutine(routineId: string) {
    return this.routineRequest(
      `/v1/routines/${encodeURIComponent(routineId)}/pause`,
      { method: 'POST' },
    );
  }

  public resumeRoutine(routineId: string) {
    return this.routineRequest(
      `/v1/routines/${encodeURIComponent(routineId)}/resume`,
      { method: 'POST' },
    );
  }

  public async runRoutineNow(input: {
    routineId: string;
    idempotencyKey: string;
  }) {
    const value: unknown = await this.request(
      `/v1/routines/${encodeURIComponent(input.routineId)}/runs`,
      { method: 'POST', idempotencyKey: input.idempotencyKey },
    );
    assertRoutineRunResource(value);
    return value;
  }

  public async listRoutineRuns(routineId: string) {
    const value: unknown = await this.request(
      `/v1/routines/${encodeURIComponent(routineId)}/runs`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.runs)
    )
      throw new Error('Vera returned an invalid routine-run list.');
    for (const run of value.runs) assertRoutineRunResource(run);
    return value as { schemaVersion: 1; runs: RoutineRunResource[] };
  }

  public async getRoutineRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ) {
    const value: unknown = await this.request(
      `/v1/routine-runs/${encodeURIComponent(runId)}`,
      options?.signal === undefined ? undefined : { signal: options.signal },
    );
    assertRoutineRunResource(value);
    return value;
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
    return this.missionRequest('/v1/missions', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        action: 'create',
        projectId: input.projectId,
        policyId: input.policyId,
        objective: input.objective,
        completionCriteria: input.completionCriteria,
        delivery: input.delivery,
      },
    });
  }

  public getMission(missionId: string) {
    return this.missionRequest(`/v1/missions/${encodeURIComponent(missionId)}`);
  }

  public decideMission(input: {
    missionId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.missionRequest(
      `/v1/missions/${encodeURIComponent(input.missionId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelMission(missionId: string) {
    return this.missionRequest(
      `/v1/missions/${encodeURIComponent(missionId)}/cancellation`,
      { method: 'POST' },
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
        task = await this.taskRequest(`/v1/runs/${encodeURIComponent(runId)}`, {
          signal,
        });
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
