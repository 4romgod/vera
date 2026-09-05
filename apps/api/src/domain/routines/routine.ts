import { z } from 'zod';

import { MachineDiagnosticSchema } from '../machines/machine.ts';
import { ExternalSignalCategorySchema } from '../external-awareness/external-signal.ts';

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/u)
  .max(100);

export const RoutineScheduleSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('daily'),
      timeZone: z.string().trim().min(1).max(100),
      localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
      daysOfWeek: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length, {
          message: 'Schedule days must be unique.',
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('interval'),
      minutes: z.number().int().min(5).max(1_440),
    })
    .strict(),
]);

const MachineHealthRoutineActionSchema = z
  .object({
    kind: z.literal('machine_health_check'),
    machineId: IdentifierSchema,
    serviceIds: z
      .array(IdentifierSchema)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Routine service IDs must be unique.',
      })
      .optional(),
  })
  .strict();

const IntegrationAwarenessProposalActionSchema = z
  .object({
    kind: z.literal('integration_awareness'),
    integrationId: z.literal('github'),
    projectId: z.string().startsWith('project_'),
    categories: z
      .array(ExternalSignalCategorySchema)
      .min(1)
      .max(4)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Awareness categories must be unique.',
      }),
  })
  .strict();

const IntegrationAwarenessRoutineActionSchema =
  IntegrationAwarenessProposalActionSchema.extend({
    connectionId: z.string().startsWith('connection_'),
    account: z
      .object({
        providerAccountId: z.string().trim().min(1).max(200),
        login: z.string().trim().min(1).max(200),
      })
      .strict(),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().trim().min(1).max(200),
      })
      .strict(),
    repository: z
      .object({
        provider: z.literal('github'),
        owner: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(100),
      })
      .strict(),
  }).omit({ projectId: true });

export const RoutineProposalActionSchema = z.discriminatedUnion('kind', [
  MachineHealthRoutineActionSchema,
  IntegrationAwarenessProposalActionSchema,
]);

export const RoutineActionSchema = z.discriminatedUnion('kind', [
  MachineHealthRoutineActionSchema,
  IntegrationAwarenessRoutineActionSchema,
]);

export const RoutineProposalArgumentsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    schedule: RoutineScheduleSchema,
    action: RoutineProposalActionSchema,
  })
  .strict();

const RoutineAuthoritySchema = z.union([
  z
    .object({
      recurringExecution: z.literal(true),
      inspectRegisteredMachine: z.literal(true),
      controlMachineServices: z.literal(false),
      modifyRoutine: z.literal(false),
    })
    .strict(),
  z
    .object({
      recurringExecution: z.literal(true),
      readExternalService: z.literal(true),
      modifyExternalService: z.literal(false),
      modifyRoutine: z.literal(false),
    })
    .strict(),
]);

export const RoutineApprovalSchema = z
  .object({
    id: z.string().startsWith('approval_'),
    status: z.enum(['pending', 'approved', 'rejected']),
    reason: z.literal('standing_instruction'),
    effect: z
      .object({
        title: z.string().trim().min(1).max(200),
        schedule: RoutineScheduleSchema,
        action: RoutineActionSchema,
        authority: RoutineAuthoritySchema,
      })
      .strict(),
    requestedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().optional(),
    decidedBy: z.string().min(1).optional(),
  })
  .strict();

export const RoutineEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: z.enum([
      'routine_created',
      'routine_approved',
      'routine_rejected',
      'routine_paused',
      'routine_resumed',
    ]),
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RoutineSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('routine_'),
    requestKey: z.string().min(1).max(200),
    principalId: z.string().min(1),
    status: z.enum(['awaiting_approval', 'active', 'paused', 'rejected']),
    approval: RoutineApprovalSchema,
    nextRunAt: z.iso.datetime().optional(),
    lastRunAt: z.iso.datetime().optional(),
    events: z.array(RoutineEventSchema).min(1).max(10_000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((routine, context) => {
    if ((routine.status === 'active') !== (routine.nextRunAt !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['nextRunAt'],
        message: 'Only active routines must have a next run time.',
      });
    }
    const approvalStatusByRoutineStatus = {
      awaiting_approval: 'pending',
      active: 'approved',
      paused: 'approved',
      rejected: 'rejected',
    } as const;
    if (
      routine.approval.status !== approvalStatusByRoutineStatus[routine.status]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approval', 'status'],
        message: 'Approval status must match the routine status.',
      });
    }
    const decided = routine.approval.status !== 'pending';
    if (
      decided !==
      (routine.approval.decidedAt !== undefined &&
        routine.approval.decidedBy !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['approval', 'decidedAt'],
        message: 'Decided approvals require decision time and principal.',
      });
    const action = routine.approval.effect.action;
    const authority = routine.approval.effect.authority;
    if (
      (action.kind === 'machine_health_check' &&
        !('inspectRegisteredMachine' in authority)) ||
      (action.kind === 'integration_awareness' &&
        !('readExternalService' in authority))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approval', 'effect', 'authority'],
        message: 'Standing authority must match the frozen routine action.',
      });
    }
  });

export const RoutineRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('routine_run_'),
    routineId: z.string().startsWith('routine_'),
    principalId: z.string().min(1),
    occurrenceKey: z.string().min(1).max(300),
    trigger: z.enum(['scheduled', 'manual']),
    scheduledFor: z.iso.datetime(),
    action: RoutineActionSchema,
    status: z.enum(['queued', 'executing', 'succeeded', 'failed', 'cancelled']),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    result: z
      .union([
        z
          .object({
            kind: z.literal('machine_health').default('machine_health'),
            outcome: z.enum(['healthy', 'attention_required']),
            summary: z.string().trim().min(1).max(2_000),
            diagnostic: MachineDiagnosticSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal('external_awareness'),
            outcome: z.enum(['quiet', 'signals_observed']),
            summary: z.string().trim().min(1).max(2_000),
            observed: z.number().int().nonnegative(),
            created: z.number().int().nonnegative(),
            changed: z.number().int().nonnegative(),
            resolved: z.number().int().nonnegative(),
          })
          .strict(),
      ])
      .optional(),
    failure: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((run, context) => {
    if ((run.status === 'succeeded') !== (run.result !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Succeeded routine runs require a result.',
      });
    }
    if ((run.status === 'failed') !== (run.failure !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Failed routine runs require a failure.',
      });
    }
    const startRequired = ['executing', 'succeeded', 'failed'].includes(
      run.status,
    );
    if (
      (startRequired && run.startedAt === undefined) ||
      (run.status === 'queued' && run.startedAt !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message:
          'Executing, succeeded, and failed routine runs require a start time.',
      });
    const completed = ['succeeded', 'failed', 'cancelled'].includes(run.status);
    if (completed !== (run.completedAt !== undefined))
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only terminal routine runs require a completion time.',
      });
  });

export const RoutineSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('routine_'),
    status: z.enum(['awaiting_approval', 'active', 'paused', 'rejected']),
    approval: RoutineApprovalSchema,
    nextRunAt: z.iso.datetime().optional(),
    lastRunAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const RoutineManagementArgumentsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      routine: RoutineProposalArgumentsSchema,
    })
    .strict(),
  z.object({ action: z.literal('list') }).strict(),
  z
    .object({
      action: z.literal('pause'),
      routineId: z.string().startsWith('routine_'),
    })
    .strict(),
  z
    .object({
      action: z.literal('resume'),
      routineId: z.string().startsWith('routine_'),
    })
    .strict(),
  z
    .object({
      action: z.literal('run_now'),
      routineId: z.string().startsWith('routine_'),
    })
    .strict(),
]);

export const RoutineManagementResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.enum(['create', 'list', 'pause', 'resume', 'run_now']),
    summary: z.string().trim().min(1).max(2_000),
    routine: RoutineSummarySchema.optional(),
    routines: z.array(RoutineSummarySchema).optional(),
    run: RoutineRunSchema.optional(),
  })
  .strict();

export type Routine = z.infer<typeof RoutineSchema>;
export type RoutineRun = z.infer<typeof RoutineRunSchema>;
export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;
export type RoutineProposalArguments = z.infer<
  typeof RoutineProposalArgumentsSchema
>;
export type RoutineAction = z.infer<typeof RoutineActionSchema>;
export type RoutineManagementArguments = z.infer<
  typeof RoutineManagementArgumentsSchema
>;
export type RoutineManagementResult = z.infer<
  typeof RoutineManagementResultSchema
>;

export const RoutineJsonSchema = z.toJSONSchema(RoutineSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
export const RoutineRunJsonSchema = z.toJSONSchema(RoutineRunSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
