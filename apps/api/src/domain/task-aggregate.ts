import { z } from 'zod';

import { DevelopmentPlanningProposalArgumentsSchema } from './capability-registry.ts';
import { DevelopmentPlanSchema } from './development-plan.ts';
import { DecisionResultSchema } from './execution-decision.ts';

export const TaskStatusSchema = z.enum([
  'active',
  'completed',
  'rejected',
  'failed',
]);

export const RunStatusSchema = z.enum([
  'deciding',
  'awaiting_approval',
  'executing',
  'succeeded',
  'rejected',
  'failed',
]);

export const ApprovalSchema = z
  .object({
    id: z.string().startsWith('approval_'),
    status: z.enum(['pending', 'approved', 'rejected']),
    reason: z.literal('external_capability_invocation'),
    capability: z
      .object({
        name: z.literal('development_planning'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: DevelopmentPlanningProposalArgumentsSchema,
    requestedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().optional(),
    decidedBy: z.string().optional(),
  })
  .strict();

export const CapabilityInvocationSchema = z
  .object({
    id: z.string().startsWith('invocation_'),
    status: z.enum(['executing', 'succeeded', 'failed']),
    capability: z
      .object({
        name: z.literal('development_planning'),
        version: z.literal(1),
      })
      .strict(),
    arguments: DevelopmentPlanningProposalArgumentsSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    model: z
      .object({
        provider: z.string(),
        model: z.string(),
        durationMs: z.number().nonnegative(),
        usage: z
          .object({
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TaskOutputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('response'),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('development_plan'),
      plan: DevelopmentPlanSchema,
    })
    .strict(),
]);

export const TaskFailureSchema = z
  .object({
    code: z.enum([
      'model_provider_failure',
      'capability_execution_failure',
      'internal_failure',
    ]),
    message: z.string(),
  })
  .strict();

export const TaskEventTypeSchema = z.enum([
  'task_created',
  'run_started',
  'model_decision_recorded',
  'approval_requested',
  'approval_approved',
  'approval_rejected',
  'capability_invocation_started',
  'capability_invocation_succeeded',
  'capability_invocation_failed',
  'run_succeeded',
  'run_rejected',
  'run_failed',
]);

export const TaskEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: TaskEventTypeSchema,
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const TaskAggregateSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    task: z
      .object({
        id: z.string().startsWith('task_'),
        requestKey: z.string().min(1),
        principalId: z.string().min(1),
        message: z.string().min(1),
        status: TaskStatusSchema,
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
      })
      .strict(),
    run: z
      .object({
        id: z.string().startsWith('run_'),
        status: RunStatusSchema,
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        decision: DecisionResultSchema.optional(),
        approval: ApprovalSchema.optional(),
        invocation: CapabilityInvocationSchema.optional(),
        output: TaskOutputSchema.optional(),
        failure: TaskFailureSchema.optional(),
      })
      .strict(),
    events: z.array(TaskEventSchema),
  })
  .strict();

export type TaskAggregate = z.infer<typeof TaskAggregateSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskEventType = z.infer<typeof TaskEventTypeSchema>;
export type TaskOutput = z.infer<typeof TaskOutputSchema>;

export const TaskAggregateJsonSchema = z.toJSONSchema(TaskAggregateSchema, {
  target: 'draft-7',
});
