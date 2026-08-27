import { z } from 'zod';

import {
  ImplementationPlanArtifactReferenceSchema,
  SoftwareChangeArtifactReferenceSchema,
  ResearchReportArtifactReferenceSchema,
  ArtifactReferenceSchema,
  PersonalTaskResultArtifactReferenceSchema,
  PersonalReminderResultArtifactReferenceSchema,
  MemoryResultArtifactReferenceSchema,
  AttachmentAnalysisArtifactReferenceSchema,
} from '../artifacts/artifact.ts';
import { CapabilityDestinationSchema } from '../capabilities/capability-destination.ts';
import { ConversationContextBundleSchema } from '../conversations/conversation-context.ts';
import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  AttachmentAnalysisArgumentsSchema,
  CapabilityAuthoritySchema,
} from '../capabilities/capability-registry.ts';
import {
  PersonalTaskActionArgumentsSchema,
  PersonalTaskResultSchema,
} from '../personal-tasks/personal-task.ts';
import { DevelopmentPlanSchema } from '../plans/development-plan.ts';
import { DecisionResultSchema } from '../model/execution-decision.ts';
import {
  ProjectContextBundleSchema,
  ProjectContextManifestSchema,
} from '../projects/project-context.ts';
import { RunBudgetSchema } from './run-budget.ts';
import { SoftwareChangeSchema } from '../changes/software-change.ts';
import { ResearchReportSchema } from '../research/research-report.ts';
import { GoalExecutionSchema } from '../goals/goal-plan.ts';
import { AdaptiveGoalExecutionSchema } from '../goals/adaptive-goal.ts';
import {
  ReminderActionArgumentsSchema,
  ReminderResultSchema,
} from '../reminders/reminder.ts';
import {
  MemoryActionArgumentsSchema,
  MemoryResultSchema,
} from '../memories/memory.ts';
import { MemoryContextBundleSchema } from '../memories/memory-context.ts';
import { AttachmentReferenceSchema } from '../attachments/attachment.ts';
import { AttachmentAnalysisSchema } from '../attachments/attachment-analysis.ts';

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

const ApprovalIdentitySchema = z
  .object({
    id: z.string().startsWith('approval_'),
    status: z.enum(['pending', 'approved', 'rejected']),
    reason: z.literal('specialist_capability_invocation'),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    contextManifest: ProjectContextManifestSchema.optional(),
    destination: CapabilityDestinationSchema.optional(),
    authority: CapabilityAuthoritySchema.optional(),
    inputArtifacts: z.array(ArtifactReferenceSchema).max(2).optional(),
    decisionEvidence: z.array(ArtifactReferenceSchema).max(3).optional(),
    attachments: z.array(AttachmentReferenceSchema).min(1).max(5).optional(),
    requestedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().optional(),
    decidedBy: z.string().optional(),
  })
  .strict();

export const ApprovalSchema = z.union([
  ApprovalIdentitySchema.extend({
    capability: z
      .object({ name: z.literal('attachment_analysis'), version: z.literal(1) })
      .strict(),
    proposedArguments: AttachmentAnalysisArgumentsSchema,
  }).strict(),
  ApprovalIdentitySchema.extend({
    capability: z
      .object({ name: z.literal('memory_management'), version: z.literal(1) })
      .strict(),
    proposedArguments: MemoryActionArgumentsSchema,
  }).strict(),
  ApprovalIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('personal_reminder_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: ReminderActionArgumentsSchema,
  }).strict(),
  ApprovalIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('personal_task_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: PersonalTaskActionArgumentsSchema,
  }).strict(),
  ApprovalIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('development_planning'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: DevelopmentPlanningProposalArgumentsSchema,
  }).strict(),
  ApprovalIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('web_research'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: WebResearchProposalArgumentsSchema,
  }).strict(),
  ApprovalIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('software_change'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: SoftwareChangeProposalArgumentsSchema,
  }).strict(),
]);

const CapabilityInvocationIdentitySchema = z
  .object({
    id: z.string().startsWith('invocation_'),
    status: z.enum(['executing', 'succeeded', 'failed']),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    contextManifest: ProjectContextManifestSchema.optional(),
    destination: CapabilityDestinationSchema.optional(),
    authority: CapabilityAuthoritySchema.optional(),
    inputArtifacts: z.array(ArtifactReferenceSchema).max(2).optional(),
    decisionEvidence: z.array(ArtifactReferenceSchema).max(3).optional(),
    attachments: z.array(AttachmentReferenceSchema).min(1).max(5).optional(),
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

export const CapabilityInvocationSchema = z.union([
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({ name: z.literal('attachment_analysis'), version: z.literal(1) })
      .strict(),
    arguments: AttachmentAnalysisArgumentsSchema,
  }).strict(),
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({ name: z.literal('memory_management'), version: z.literal(1) })
      .strict(),
    arguments: MemoryActionArgumentsSchema,
  }).strict(),
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('personal_reminder_management'),
        version: z.literal(1),
      })
      .strict(),
    arguments: ReminderActionArgumentsSchema,
  }).strict(),
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('personal_task_management'),
        version: z.literal(1),
      })
      .strict(),
    arguments: PersonalTaskActionArgumentsSchema,
  }).strict(),
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('development_planning'),
        version: z.literal(1),
      })
      .strict(),
    arguments: DevelopmentPlanningProposalArgumentsSchema,
  }).strict(),
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('web_research'),
        version: z.literal(1),
      })
      .strict(),
    arguments: WebResearchProposalArgumentsSchema,
  }).strict(),
  CapabilityInvocationIdentitySchema.extend({
    capability: z
      .object({
        name: z.literal('software_change'),
        version: z.literal(1),
      })
      .strict(),
    arguments: SoftwareChangeProposalArgumentsSchema,
  }).strict(),
]);

export const TaskOutputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('attachment_analysis'),
      analysis: AttachmentAnalysisSchema,
      artifact: AttachmentAnalysisArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('memory_result'),
      result: MemoryResultSchema,
      artifact: MemoryResultArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('personal_reminder_result'),
      result: ReminderResultSchema,
      artifact: PersonalReminderResultArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('personal_task_result'),
      result: PersonalTaskResultSchema,
      artifact: PersonalTaskResultArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('response'),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('goal_result'),
      objective: z.string().min(1).max(10_000),
      summary: z.string().min(1).max(2_000),
      artifacts: z.array(ArtifactReferenceSchema).min(2).max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal('adaptive_goal_result'),
      objective: z.string().min(1).max(10_000),
      message: z.string().min(1).max(20_000),
      evidence: z.array(ArtifactReferenceSchema).min(1).max(3),
      artifacts: z.array(ArtifactReferenceSchema).min(1).max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal('development_plan'),
      plan: DevelopmentPlanSchema,
      artifact: ImplementationPlanArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('software_change'),
      change: SoftwareChangeSchema,
      artifact: SoftwareChangeArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('research_report'),
      report: ResearchReportSchema,
      artifact: ResearchReportArtifactReferenceSchema.optional(),
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
      'memory_context_failure',
      'adaptive_goal_failure',
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
  'memory_context_assembled',
  'conversation_reply_pending',
  'conversation_reply_projected',
  'goal_planned',
  'goal_step_awaiting_approval',
  'goal_step_succeeded',
  'goal_succeeded',
  'adaptive_goal_planned',
  'adaptive_goal_observation_recorded',
  'adaptive_goal_continuation_recorded',
  'adaptive_goal_succeeded',
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
        attachments: z.array(AttachmentReferenceSchema).max(5).optional(),
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
        approvalHistory: z.array(ApprovalSchema).max(2).optional(),
        invocation: CapabilityInvocationSchema.optional(),
        invocationHistory: z
          .array(CapabilityInvocationSchema)
          .max(2)
          .optional(),
        output: TaskOutputSchema.optional(),
        failure: TaskFailureSchema.optional(),
        budget: RunBudgetSchema.optional(),
        context: ProjectContextBundleSchema.optional(),
        conversationContext: ConversationContextBundleSchema.optional(),
        memoryContext: MemoryContextBundleSchema.optional(),
        conversationReply: ConversationReplyProjectionSchema.optional(),
        goal: z
          .union([GoalExecutionSchema, AdaptiveGoalExecutionSchema])
          .optional(),
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
