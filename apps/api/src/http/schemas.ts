import { z } from 'zod';

import {
  ApprovalSchema,
  CapabilityInvocationSchema,
  RunStatusSchema,
  TaskEventSchema,
  TaskFailureSchema,
  TaskOutputSchema,
  TaskStatusSchema,
} from '../domain/task-aggregate.ts';
import { DecisionResultSchema } from '../domain/execution-decision.ts';

export const EvaluateRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export const SubmitTaskRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();

export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;

export const IdempotencyHeadersSchema = z.looseObject({
  'idempotency-key': z.string().trim().min(8).max(200),
});

export type IdempotencyHeaders = z.infer<typeof IdempotencyHeadersSchema>;

export const ResourceIdParamsSchema = z
  .object({
    id: z.string().min(1).max(200),
  })
  .strict();

export type ResourceIdParams = z.infer<typeof ResourceIdParamsSchema>;

export const ApprovalDecisionRequestSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
  })
  .strict();

export type ApprovalDecisionRequest = z.infer<
  typeof ApprovalDecisionRequestSchema
>;

export const TaskLifecycleResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    taskStatus: TaskStatusSchema,
    runStatus: RunStatusSchema,
    message: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    decision: DecisionResultSchema.optional(),
    approval: ApprovalSchema.optional(),
    invocation: CapabilityInvocationSchema.optional(),
    output: TaskOutputSchema.optional(),
    failure: TaskFailureSchema.optional(),
    links: z
      .object({
        task: z.string(),
        run: z.string(),
        events: z.string(),
        approval: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const TaskEventsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    events: z.array(TaskEventSchema),
  })
  .strict();

export const EvaluateRequestJsonSchema = z.toJSONSchema(EvaluateRequestSchema, {
  target: 'draft-7',
});

export const SubmitTaskRequestJsonSchema = z.toJSONSchema(
  SubmitTaskRequestSchema,
  { target: 'draft-7' },
);

export const IdempotencyHeadersJsonSchema = z.toJSONSchema(
  IdempotencyHeadersSchema,
  { target: 'draft-7' },
);

export const ResourceIdParamsJsonSchema = z.toJSONSchema(
  ResourceIdParamsSchema,
  { target: 'draft-7' },
);

export const ApprovalDecisionRequestJsonSchema = z.toJSONSchema(
  ApprovalDecisionRequestSchema,
  { target: 'draft-7' },
);

export const TaskLifecycleResponseJsonSchema = z.toJSONSchema(
  TaskLifecycleResponseSchema,
  { target: 'draft-7' },
);

export const TaskEventsResponseJsonSchema = z.toJSONSchema(
  TaskEventsResponseSchema,
  { target: 'draft-7' },
);

const ModelIdentitySchema = z
  .object({
    name: z.string(),
    model: z.string(),
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.literal('vera-api'),
    model: ModelIdentitySchema,
  })
  .strict();

export const ReadyResponseSchema = z
  .object({
    status: z.literal('ready'),
    service: z.literal('vera-api'),
    model: ModelIdentitySchema.extend({
      providerVersion: z.string().optional(),
      durationMs: z.number().nonnegative(),
    }).strict(),
  })
  .strict();

export const NotReadyResponseSchema = z
  .object({
    status: z.literal('not_ready'),
    service: z.literal('vera-api'),
    model: ModelIdentitySchema,
    error: z
      .object({
        code: z.enum([
          'operational_store_unavailable',
          'scratchpad_unavailable',
          'model_not_found',
          'provider_request_rejected',
          'provider_response_invalid',
          'provider_timeout',
          'provider_unavailable',
        ]),
        message: z.string(),
        dependency: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const HealthResponseJsonSchema = z.toJSONSchema(HealthResponseSchema, {
  target: 'draft-7',
});

export const ReadyResponseJsonSchema = z.toJSONSchema(ReadyResponseSchema, {
  target: 'draft-7',
});

export const NotReadyResponseJsonSchema = z.toJSONSchema(
  NotReadyResponseSchema,
  { target: 'draft-7' },
);
