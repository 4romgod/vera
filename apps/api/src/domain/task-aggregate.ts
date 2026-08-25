import { z } from 'zod';

import { ArtifactReferenceSchema } from './artifact.ts';
import { CapabilityDestinationSchema } from './capability-destination.ts';
import { ConversationContextBundleSchema } from './conversation-context.ts';
import { DevelopmentPlanningProposalArgumentsSchema } from './capability-registry.ts';
import { DevelopmentPlanSchema } from './development-plan.ts';
import { DecisionResultSchema } from './execution-decision.ts';
import {
  ProjectContextBundleSchema,
  ProjectContextManifestSchema,
} from './project-context.ts';
import { RunBudgetSchema } from './run-budget.ts';

export const TaskStatusSchema = z.enum([
  'active',
  'completed',
  'rejected',
  'failed',
  'cancelled',
]);

export const RunStatusSchema = z.enum([
  'deciding',
  'awaiting_approval',
  'executing',
  'succeeded',
  'rejected',
  'failed',
  'cancellation_requested',
  'cancelled',
]);

export const ApprovalSchema = z
  .object({
    id: z.string().startsWith('approval_'),
    status: z.enum(['pending', 'approved', 'rejected']),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('development_planning'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: DevelopmentPlanningProposalArgumentsSchema,
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    contextManifest: ProjectContextManifestSchema.optional(),
    destination: CapabilityDestinationSchema.optional(),
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
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    contextManifest: ProjectContextManifestSchema.optional(),
    destination: CapabilityDestinationSchema.optional(),
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
      artifact: ArtifactReferenceSchema.optional(),
    })
    .strict(),
]);

export const TaskFailureSchema = z
  .object({
    code: z.enum([
      'model_provider_failure',
      'capability_execution_failure',
      'internal_failure',
      'project_required',
      'project_not_found',
      'project_context_failure',
      'conversation_context_failure',
      'budget_exhausted',
      'cancelled',
    ]),
    message: z.string(),
  })
  .strict();

export const ConversationReplyProjectionSchema = z
  .object({
    status: z.enum(['pending', 'projected']),
    messageId: z.string().startsWith('message_'),
    requestKey: z.string().min(1),
    content: z.string().min(1).max(20_000),
    createdAt: z.iso.datetime(),
    projectedAt: z.iso.datetime().optional(),
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
  'context_assembled',
  'budget_assigned',
  'budget_consumed',
  'budget_exhausted',
  'artifact_created',
  'cancellation_requested',
  'run_cancelled',
  'conversation_context_assembled',
  'conversation_reply_pending',
  'conversation_reply_projected',
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
        conversationId: z.string().startsWith('conversation_').optional(),
        messageId: z.string().startsWith('message_').optional(),
        projectId: z.string().startsWith('project_').optional(),
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
        budget: RunBudgetSchema.optional(),
        context: ProjectContextBundleSchema.optional(),
        conversationContext: ConversationContextBundleSchema.optional(),
        conversationReply: ConversationReplyProjectionSchema.optional(),
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
