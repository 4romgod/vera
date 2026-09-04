import { z } from 'zod';

import { MachineDiagnosticSchema } from '../machines/machine.ts';

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/u)
  .max(100);

export const RoutineScheduleSchema = z
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
  .strict();

export const RoutineActionSchema = z
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

export const RoutineProposalArgumentsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    schedule: RoutineScheduleSchema,
    action: RoutineActionSchema,
  })
  .strict();

const RoutineAuthoritySchema = z
  .object({
    recurringExecution: z.literal(true),
    inspectRegisteredMachine: z.literal(true),
    controlMachineServices: z.literal(false),
    modifyRoutine: z.literal(false),
  })
  .strict();

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
      .object({
        outcome: z.enum(['healthy', 'attention_required']),
        summary: z.string().trim().min(1).max(2_000),
        diagnostic: MachineDiagnosticSchema,
      })
      .strict()
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
