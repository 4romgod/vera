import { createHash, randomUUID } from 'node:crypto';

import {
  RoutineManagementResultSchema,
  RoutineRunSchema,
  RoutineSchema,
  RoutineSummarySchema,
  type Routine,
  type RoutineManagementArguments,
  type RoutineManagementResult,
  type RoutineProposalArguments,
  type RoutineRun,
} from '../../domain/routines/routine.ts';
import type { MachineOperations } from '../../ports/machines/machine-operations.ts';
import type { ExternalAwarenessOperations } from '../../ports/external-awareness/external-awareness-operations.ts';
import type { RoutineStore } from '../../ports/persistence/routine-store.ts';
import {
  nextRoutineOccurrence,
  assertValidTimeZone,
} from './routine-schedule.ts';

export type RoutineErrorCode =
  | 'routine_not_found'
  | 'routine_run_not_found'
  | 'routine_machine_not_found'
  | 'routine_service_not_found'
  | 'routine_idempotency_key_reused'
  | 'routine_approval_already_decided'
  | 'routine_invalid_transition'
  | 'routine_concurrent_transition_failed';

export class RoutineError extends Error {
  public constructor(
    message: string,
    public readonly code: RoutineErrorCode,
  ) {
    super(message);
    this.name = 'RoutineError';
  }
}

export type RoutineLifecycle = {
  create(
    input: RoutineProposalArguments & {
      principalId: string;
      requestKey: string;
    },
  ): Promise<Routine>;
  get(principalId: string, routineId: string): Promise<Routine>;
  getRun(principalId: string, runId: string): Promise<RoutineRun>;
  list(principalId: string): Promise<Routine[]>;
  decideApproval(input: {
    principalId: string;
    routineId: string;
    decision: 'approved' | 'rejected';
  }): Promise<Routine>;
  pause(principalId: string, routineId: string): Promise<Routine>;
  resume(principalId: string, routineId: string): Promise<Routine>;
  runNow(input: {
    principalId: string;
    routineId: string;
    requestKey: string;
  }): Promise<RoutineRun>;
  listRuns(principalId: string, routineId: string): Promise<RoutineRun[]>;
  materializeDue(routine: Routine): Promise<RoutineRun>;
  executeRun(principalId: string, runId: string): Promise<RoutineRun>;
  invoke(input: {
    principalId: string;
    requestKey: string;
    arguments: RoutineManagementArguments;
  }): Promise<RoutineManagementResult>;
};

function deterministicId(
  prefix: 'routine' | 'routine_run',
  ...parts: string[]
) {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function stableEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function routineSummary(routine: Routine) {
  return RoutineSummarySchema.parse({
    schemaVersion: routine.schemaVersion,
    version: routine.version,
    id: routine.id,
    status: routine.status,
    approval: routine.approval,
    ...(routine.nextRunAt === undefined
      ? {}
      : { nextRunAt: routine.nextRunAt }),
    ...(routine.lastRunAt === undefined
      ? {}
      : { lastRunAt: routine.lastRunAt }),
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt,
  });
}

function machineOutcome(
  diagnostic: Awaited<ReturnType<MachineOperations['inspect']>>,
) {
  const unhealthy = [...diagnostic.diagnostics, ...diagnostic.services].filter(
    (entry) => entry.observation.status !== 'healthy',
  );
  return {
    kind: 'machine_health' as const,
    outcome:
      unhealthy.length === 0
        ? ('healthy' as const)
        : ('attention_required' as const),
    summary:
      unhealthy.length === 0
        ? `${diagnostic.machine.displayName} passed the scheduled health check.`
        : `${diagnostic.machine.displayName} has ${String(unhealthy.length)} unhealthy or unknown ${unhealthy.length === 1 ? 'check' : 'checks'}: ${unhealthy.map((entry) => entry.id).join(', ')}.`,
    diagnostic,
  };
}

async function externalOutcome(
  operations: ExternalAwarenessOperations | undefined,
  input: Parameters<ExternalAwarenessOperations['execute']>[0],
) {
  if (operations === undefined) {
    throw new Error('External awareness is not configured.');
  }
  const result = await operations.execute(input);
  const changed = result.created + result.changed;
  return {
    kind: 'external_awareness' as const,
    outcome: changed === 0 ? ('quiet' as const) : ('signals_observed' as const),
    summary:
      changed === 0
        ? result.resolved === 0
          ? 'No new external signals need attention.'
          : `No new external signals; ${String(result.resolved)} ${result.resolved === 1 ? 'signal was' : 'signals were'} resolved.`
        : `${String(changed)} new or changed external ${changed === 1 ? 'signal needs' : 'signals need'} attention.`,
    observed: result.observations.length,
    created: result.created,
    changed: result.changed,
    resolved: result.resolved,
  };
}

async function freezeExternalAction(
  operations: ExternalAwarenessOperations | undefined,
  input: Parameters<ExternalAwarenessOperations['freeze']>[0],
) {
  if (operations === undefined) {
    throw new RoutineError(
      'External awareness is not available on this Vera host.',
      'routine_invalid_transition',
    );
  }
  return operations.freeze(input);
}

export function createRoutineLifecycle(options: {
  store: RoutineStore;
  machines: MachineOperations;
  externalAwareness?: ExternalAwarenessOperations;
  clock?: () => Date;
  createId?: (prefix: string) => string;
}): RoutineLifecycle {
  const clock = options.clock ?? (() => new Date());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  function validateProposal(proposal: RoutineProposalArguments) {
    if (proposal.schedule.kind === 'daily')
      assertValidTimeZone(proposal.schedule.timeZone);
    const action = proposal.action;
    if (action.kind === 'integration_awareness') {
      if (options.externalAwareness === undefined) {
        throw new RoutineError(
          'External awareness is not available on this Vera host.',
          'routine_invalid_transition',
        );
      }
      return;
    }
    const machine = options.machines.catalog.machines.find(
      ({ id }) => id === action.machineId,
    );
    if (machine === undefined) {
      throw new RoutineError(
        `Machine ${action.machineId} is not registered.`,
        'routine_machine_not_found',
      );
    }
    const missing =
      action.serviceIds?.filter(
        (id) => !machine.services.some((service) => service.id === id),
      ) ?? [];
    if (missing.length > 0) {
      throw new RoutineError(
        `Services are not registered on ${machine.displayName}: ${missing.join(', ')}.`,
        'routine_service_not_found',
      );
    }
  }

  async function requireRoutine(principalId: string, routineId: string) {
    const routine = await options.store.findById(principalId, routineId);
    if (routine === null)
      throw new RoutineError(
        `Routine ${routineId} was not found.`,
        'routine_not_found',
      );
    return routine;
  }

  async function update(
    principalId: string,
    routineId: string,
    mutate: (routine: Routine) => boolean,
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await requireRoutine(principalId, routineId);
      const candidate = structuredClone(current);
      if (!mutate(candidate)) return current;
      candidate.version = current.version + 1;
      const parsed = RoutineSchema.parse(candidate);
      if (await options.store.replace(parsed, current.version)) return parsed;
    }
    throw new RoutineError(
      `Routine ${routineId} changed concurrently.`,
      'routine_concurrent_transition_failed',
    );
  }

  function append(
    routine: Routine,
    type: Routine['events'][number]['type'],
    now: string,
    data: Record<string, unknown>,
  ) {
    routine.events.push({
      schemaVersion: 1,
      id: createId('event'),
      sequence: routine.events.length + 1,
      type,
      occurredAt: now,
      data,
    });
    routine.updatedAt = now;
  }

  async function create(
    input: RoutineProposalArguments & {
      principalId: string;
      requestKey: string;
    },
  ) {
    validateProposal(input);
    const normalizedSchedule =
      input.schedule.kind === 'daily'
        ? {
            ...input.schedule,
            daysOfWeek: [...input.schedule.daysOfWeek].sort(
              (left, right) => left - right,
            ),
          }
        : input.schedule;
    const normalizedRequestedAction =
      input.action.kind === 'integration_awareness'
        ? {
            ...input.action,
            categories: [...input.action.categories].sort(),
          }
        : {
            ...input.action,
            ...(input.action.serviceIds === undefined
              ? {}
              : { serviceIds: [...input.action.serviceIds].sort() }),
          };
    const existing = await options.store.findByRequestKey(
      input.principalId,
      input.requestKey,
    );
    if (existing !== null) {
      const existingAction = existing.approval.effect.action;
      const sameRequestedAction =
        existingAction.kind === normalizedRequestedAction.kind &&
        (existingAction.kind === 'machine_health_check'
          ? stableEqual(existingAction, normalizedRequestedAction)
          : normalizedRequestedAction.kind === 'integration_awareness' &&
            existingAction.project.id === normalizedRequestedAction.projectId &&
            stableEqual(
              existingAction.categories,
              normalizedRequestedAction.categories,
            ));
      if (
        existing.approval.effect.title !== input.title.trim() ||
        !stableEqual(existing.approval.effect.schedule, normalizedSchedule) ||
        !sameRequestedAction
      ) {
        throw new RoutineError(
          `Idempotency key ${input.requestKey} belongs to another routine.`,
          'routine_idempotency_key_reused',
        );
      }
      return existing;
    }
    const action =
      normalizedRequestedAction.kind === 'integration_awareness'
        ? await freezeExternalAction(options.externalAwareness, {
            principalId: input.principalId,
            integrationId: normalizedRequestedAction.integrationId,
            projectId: normalizedRequestedAction.projectId,
            categories: normalizedRequestedAction.categories,
          })
        : normalizedRequestedAction;
    const proposal = {
      title: input.title.trim(),
      schedule: normalizedSchedule,
      action,
    };
    const now = clock().toISOString();
    const routine = RoutineSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: deterministicId('routine', input.principalId, input.requestKey),
      requestKey: input.requestKey,
      principalId: input.principalId,
      status: 'awaiting_approval',
      approval: {
        id: createId('approval'),
        status: 'pending',
        reason: 'standing_instruction',
        effect: {
          ...proposal,
          authority:
            proposal.action.kind === 'machine_health_check'
              ? {
                  recurringExecution: true,
                  inspectRegisteredMachine: true,
                  controlMachineServices: false,
                  modifyRoutine: false,
                }
              : {
                  recurringExecution: true,
                  readExternalService: true,
                  modifyExternalService: false,
                  modifyRoutine: false,
                },
        },
        requestedAt: now,
      },
      events: [
        {
          schemaVersion: 1,
          id: createId('event'),
          sequence: 1,
          type: 'routine_created',
          occurredAt: now,
          data:
            proposal.action.kind === 'machine_health_check'
              ? { machineId: proposal.action.machineId }
              : {
                  integrationId: proposal.action.integrationId,
                  projectId: proposal.action.project.id,
                  repository: proposal.action.repository,
                },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    const stored = await options.store.create(routine);
    if (
      !stored.created &&
      !stableEqual(stored.routine.approval.effect, routine.approval.effect)
    ) {
      throw new RoutineError(
        `Idempotency key ${input.requestKey} belongs to another routine.`,
        'routine_idempotency_key_reused',
      );
    }
    return stored.routine;
  }

  async function createRun(
    routine: Routine,
    trigger: 'scheduled' | 'manual',
    scheduledFor: string,
    occurrenceKey: string,
  ) {
    const now = clock().toISOString();
    const run = RoutineRunSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: deterministicId('routine_run', routine.id, occurrenceKey),
      routineId: routine.id,
      principalId: routine.principalId,
      occurrenceKey,
      trigger,
      scheduledFor,
      action: routine.approval.effect.action,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    });
    return (await options.store.createRun(run)).run;
  }

  async function pause(principalId: string, routineId: string) {
    return update(principalId, routineId, (routine) => {
      if (routine.status === 'paused') return false;
      if (routine.status !== 'active')
        throw new RoutineError(
          'Only an active routine can be paused.',
          'routine_invalid_transition',
        );
      const now = clock().toISOString();
      routine.status = 'paused';
      delete routine.nextRunAt;
      append(routine, 'routine_paused', now, {});
      return true;
    });
  }

  async function resume(principalId: string, routineId: string) {
    return update(principalId, routineId, (routine) => {
      if (routine.status === 'active') return false;
      if (routine.status !== 'paused' || routine.approval.status !== 'approved')
        throw new RoutineError(
          'Only an approved paused routine can be resumed.',
          'routine_invalid_transition',
        );
      const now = clock().toISOString();
      routine.status = 'active';
      routine.nextRunAt = nextRoutineOccurrence(
        routine.approval.effect.schedule,
        new Date(now),
        routine.approval.effect.schedule.kind === 'daily'
          ? routine.lastRunAt
          : undefined,
      );
      append(routine, 'routine_resumed', now, {});
      return true;
    });
  }

  async function runNow(input: {
    principalId: string;
    routineId: string;
    requestKey: string;
  }) {
    const routine = await requireRoutine(input.principalId, input.routineId);
    const runId = deterministicId(
      'routine_run',
      routine.id,
      `manual:${input.requestKey}`,
    );
    const existing = await options.store.findRunById(input.principalId, runId);
    if (existing !== null) return existing;
    if (routine.approval.status !== 'approved' || routine.status !== 'active')
      throw new RoutineError(
        'Only an active approved routine can run.',
        'routine_invalid_transition',
      );
    const now = clock().toISOString();
    return createRun(routine, 'manual', now, `manual:${input.requestKey}`);
  }

  async function executeRun(
    principalId: string,
    runId: string,
  ): Promise<RoutineRun> {
    const current = await options.store.findRunById(principalId, runId);
    if (current === null)
      throw new RoutineError(
        `Routine run ${runId} was not found.`,
        'routine_run_not_found',
      );
    if (
      current.status === 'succeeded' ||
      current.status === 'failed' ||
      current.status === 'cancelled'
    )
      return current;
    const routine = await requireRoutine(principalId, current.routineId);
    if (routine.status !== 'active') {
      const now = clock().toISOString();
      const cancelled = RoutineRunSchema.parse({
        ...current,
        version: current.version + 1,
        status: 'cancelled',
        completedAt: now,
        updatedAt: now,
      });
      if (!(await options.store.replaceRun(cancelled, current.version)))
        return executeRun(principalId, runId);
      return cancelled;
    }
    let executing = current;
    if (current.status === 'queued') {
      const now = clock().toISOString();
      const candidate = RoutineRunSchema.parse({
        ...current,
        version: current.version + 1,
        status: 'executing',
        startedAt: now,
        updatedAt: now,
      });
      if (!(await options.store.replaceRun(candidate, current.version)))
        return executeRun(principalId, runId);
      executing = candidate;
    }
    try {
      const result =
        executing.action.kind === 'machine_health_check'
          ? machineOutcome(
              await options.machines.inspect({
                machineId: executing.action.machineId,
                ...(executing.action.serviceIds === undefined
                  ? {}
                  : { serviceIds: executing.action.serviceIds }),
              }),
            )
          : await externalOutcome(options.externalAwareness, {
              principalId,
              routineId: executing.routineId,
              action: executing.action,
              observedAt: clock().toISOString(),
            });
      const now = clock().toISOString();
      const completed = RoutineRunSchema.parse({
        ...executing,
        version: executing.version + 1,
        status: 'succeeded',
        result,
        completedAt: now,
        updatedAt: now,
      });
      if (!(await options.store.replaceRun(completed, executing.version)))
        return await executeRun(principalId, runId);
      return completed;
    } catch (error) {
      const now = clock().toISOString();
      const failed = RoutineRunSchema.parse({
        ...executing,
        version: executing.version + 1,
        status: 'failed',
        failure: {
          code:
            executing.action.kind === 'machine_health_check'
              ? 'machine_inspection_failed'
              : 'external_awareness_failed',
          message:
            error instanceof Error
              ? error.message.slice(0, 2_000)
              : executing.action.kind === 'machine_health_check'
                ? 'The machine inspection failed.'
                : 'The external awareness check failed.',
        },
        completedAt: now,
        updatedAt: now,
      });
      if (!(await options.store.replaceRun(failed, executing.version)))
        return executeRun(principalId, runId);
      return failed;
    }
  }

  return {
    create,
    async get(principalId, routineId) {
      return requireRoutine(principalId, routineId);
    },
    async getRun(principalId, runId) {
      const run = await options.store.findRunById(principalId, runId);
      if (run === null)
        throw new RoutineError(
          `Routine run ${runId} was not found.`,
          'routine_run_not_found',
        );
      return run;
    },
    async list(principalId) {
      return options.store.list(principalId, 100);
    },
    async decideApproval(input) {
      return update(input.principalId, input.routineId, (routine) => {
        if (routine.approval.status !== 'pending') {
          if (
            routine.approval.status === input.decision &&
            routine.approval.decidedBy === input.principalId
          )
            return false;
          throw new RoutineError(
            'Routine approval was already decided.',
            'routine_approval_already_decided',
          );
        }
        const now = clock().toISOString();
        routine.approval.status = input.decision;
        routine.approval.decidedAt = now;
        routine.approval.decidedBy = input.principalId;
        routine.status = input.decision === 'approved' ? 'active' : 'rejected';
        if (input.decision === 'approved') {
          routine.nextRunAt = nextRoutineOccurrence(
            routine.approval.effect.schedule,
            new Date(now),
          );
        }
        append(
          routine,
          input.decision === 'approved'
            ? 'routine_approved'
            : 'routine_rejected',
          now,
          { approvalId: routine.approval.id },
        );
        return true;
      });
    },
    pause,
    resume,
    runNow,
    async listRuns(principalId, routineId) {
      await requireRoutine(principalId, routineId);
      return options.store.listRuns(principalId, routineId, 50);
    },
    async materializeDue(routine) {
      const current = await requireRoutine(routine.principalId, routine.id);
      if (current.status !== 'active' || current.nextRunAt === undefined)
        throw new RoutineError(
          'Routine is no longer due.',
          'routine_invalid_transition',
        );
      const scheduledFor = current.nextRunAt;
      const run = await createRun(
        current,
        'scheduled',
        scheduledFor,
        `scheduled:${scheduledFor}`,
      );
      await update(current.principalId, current.id, (candidate) => {
        if (
          candidate.status !== 'active' ||
          candidate.nextRunAt !== scheduledFor
        )
          return false;
        const now = clock().toISOString();
        candidate.lastRunAt = scheduledFor;
        candidate.nextRunAt = nextRoutineOccurrence(
          candidate.approval.effect.schedule,
          new Date(scheduledFor),
          scheduledFor,
        );
        candidate.updatedAt = now;
        return true;
      });
      return run;
    },
    executeRun,
    async invoke(input) {
      const args = input.arguments;
      if (args.action === 'create') {
        const routine = await create({
          ...args.routine,
          principalId: input.principalId,
          requestKey: input.requestKey,
        });
        return RoutineManagementResultSchema.parse({
          schemaVersion: 1,
          action: args.action,
          summary: `Created ${routine.approval.effect.title}; it is waiting for approval.`,
          routine: routineSummary(routine),
        });
      }
      if (args.action === 'list') {
        const routines = await options.store.list(input.principalId, 100);
        return RoutineManagementResultSchema.parse({
          schemaVersion: 1,
          action: args.action,
          summary:
            routines.length === 0
              ? 'No routines are configured.'
              : `${String(routines.length)} ${routines.length === 1 ? 'routine is' : 'routines are'} configured.`,
          routines: routines.map(routineSummary),
        });
      }
      const routine =
        args.action === 'pause'
          ? await pause(input.principalId, args.routineId)
          : args.action === 'resume'
            ? await resume(input.principalId, args.routineId)
            : await requireRoutine(input.principalId, args.routineId);
      if (args.action === 'run_now') {
        const run = await runNow({
          principalId: input.principalId,
          routineId: args.routineId,
          requestKey: input.requestKey,
        });
        return RoutineManagementResultSchema.parse({
          schemaVersion: 1,
          action: args.action,
          summary: `Queued ${routine.approval.effect.title} to run now.`,
          routine: routineSummary(routine),
          run,
        });
      }
      return RoutineManagementResultSchema.parse({
        schemaVersion: 1,
        action: args.action,
        summary: `${routine.approval.effect.title} is now ${routine.status}.`,
        routine: routineSummary(routine),
      });
    },
  };
}
