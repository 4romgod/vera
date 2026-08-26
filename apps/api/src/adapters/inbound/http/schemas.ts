import { z } from 'zod';
import { CapabilityCatalogSchema } from '../../../domain/capabilities/capability-registry.ts';

import {
  ApprovalSchema,
  CapabilityInvocationSchema,
  RunStatusSchema,
  TaskEventSchema,
  TaskFailureSchema,
  TaskOutputSchema,
  TaskStatusSchema,
} from '../../../domain/tasks/task-aggregate.ts';
import { DecisionResultSchema } from '../../../domain/model/execution-decision.ts';
import {
  ImplementationPlanArtifactSchema,
  ResearchReportArtifactSchema,
  SoftwareChangeArtifactSchema,
  PersonalTaskResultArtifactSchema,
  PersonalReminderResultArtifactSchema,
} from '../../../domain/artifacts/artifact.ts';
import {
  ConversationSchema,
  ConversationSummarySchema,
} from '../../../domain/conversations/conversation.ts';
import { ProjectSchema } from '../../../domain/projects/project.ts';
import { RunBudgetSchema } from '../../../domain/tasks/run-budget.ts';
import { ConversationContextManifestSchema } from '../../../domain/conversations/conversation-context.ts';
import {
  ChangeApplicationEventSchema,
  SoftwareChangeApplicationSchema,
} from '../../../domain/changes/software-change-application.ts';
import { GoalExecutionSchema } from '../../../domain/goals/goal-plan.ts';
import { AdaptiveGoalExecutionSchema } from '../../../domain/goals/adaptive-goal.ts';
import { PersonalTaskResourceSchema } from '../../../domain/personal-tasks/personal-task.ts';
import {
  NotificationResourceSchema,
  ReminderResourceSchema,
  ReminderStatusSchema,
} from '../../../domain/reminders/reminder.ts';

export const EvaluateRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export const SubmitTaskRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
    projectId: z.string().startsWith('project_').optional(),
  })
  .strict();

export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;

export const RegisterProjectRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    source: z
      .object({
        kind: z.literal('local_git'),
        rootPath: z.string().min(1).max(4_000),
      })
      .strict(),
  })
  .strict();

export type RegisterProjectRequest = z.infer<
  typeof RegisterProjectRequestSchema
>;

export const CreateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type CreateConversationRequest = z.infer<
  typeof CreateConversationRequestSchema
>;

export const CreateConversationMessageRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(20_000),
    projectId: z.string().startsWith('project_').optional(),
  })
  .strict();

export type CreateConversationMessageRequest = z.infer<
  typeof CreateConversationMessageRequestSchema
>;

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

export const ChangeApplicationResponseSchema =
  SoftwareChangeApplicationSchema.omit({
    principalId: true,
    requestKey: true,
    events: true,
  }).extend({
    links: z
      .object({
        application: z.string(),
        events: z.string(),
        decision: z.string().optional(),
        cancellation: z.string().optional(),
      })
      .strict(),
  });

export const ChangeApplicationEventsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: z.string().startsWith('application_'),
    events: z.array(ChangeApplicationEventSchema),
  })
  .strict();

export const TaskLifecycleResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    taskStatus: TaskStatusSchema,
    runStatus: RunStatusSchema,
    message: z.string(),
    projectId: z.string().startsWith('project_').optional(),
    conversationId: z.string().startsWith('conversation_').optional(),
    messageId: z.string().startsWith('message_').optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    decision: DecisionResultSchema.optional(),
    approval: ApprovalSchema.optional(),
    approvalHistory: z.array(ApprovalSchema).max(2).optional(),
    invocation: CapabilityInvocationSchema.optional(),
    invocationHistory: z.array(CapabilityInvocationSchema).max(2).optional(),
    output: TaskOutputSchema.optional(),
    failure: TaskFailureSchema.optional(),
    budget: RunBudgetSchema.optional(),
    conversationContextManifest: ConversationContextManifestSchema.optional(),
    conversationReply: z
      .object({
        status: z.enum(['pending', 'projected']),
        messageId: z.string().startsWith('message_'),
        createdAt: z.iso.datetime(),
        projectedAt: z.iso.datetime().optional(),
      })
      .strict()
      .optional(),
    goal: z
      .union([GoalExecutionSchema, AdaptiveGoalExecutionSchema])
      .optional(),
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

export const ProjectResponseSchema = ProjectSchema.omit({
  principalId: true,
  registrationKey: true,
});

export const ProjectsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z.array(ProjectResponseSchema),
  })
  .strict();

export const ConversationResponseSchema = ConversationSchema.omit({
  principalId: true,
  creationKey: true,
}).extend({
  messages: z.array(
    ConversationSchema.shape.messages.element.omit({ requestKey: true }),
  ),
});

export const ConversationsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversations: z.array(ConversationSummarySchema),
  })
  .strict();

export const ArtifactResponseSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactSchema.omit({ principalId: true }),
  SoftwareChangeArtifactSchema.omit({ principalId: true }),
  ResearchReportArtifactSchema.omit({ principalId: true }),
  PersonalTaskResultArtifactSchema.omit({ principalId: true }),
  PersonalReminderResultArtifactSchema.omit({ principalId: true }),
]);

export const PersonalTaskListQuerySchema = z
  .object({
    status: z.enum(['all', 'open', 'completed']).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

export type PersonalTaskListQuery = z.infer<typeof PersonalTaskListQuerySchema>;

export const PersonalTaskResponseSchema = PersonalTaskResourceSchema;

export const PersonalTasksResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    tasks: z.array(PersonalTaskResourceSchema).max(100),
  })
  .strict();

export const ReminderListQuerySchema = z
  .object({
    status: z.union([z.literal('all'), ReminderStatusSchema]).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

export type ReminderListQuery = z.infer<typeof ReminderListQuerySchema>;

export const ReminderResponseSchema = ReminderResourceSchema;

export const RemindersResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    reminders: z.array(ReminderResourceSchema).max(100),
  })
  .strict();

export const NotificationListQuerySchema = z
  .object({
    after: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    notifications: z.array(NotificationResourceSchema).max(100),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export const EvaluateRequestJsonSchema = z.toJSONSchema(EvaluateRequestSchema, {
  target: 'draft-7',
});

export const SubmitTaskRequestJsonSchema = z.toJSONSchema(
  SubmitTaskRequestSchema,
  { target: 'draft-7' },
);

export const RegisterProjectRequestJsonSchema = z.toJSONSchema(
  RegisterProjectRequestSchema,
  { target: 'draft-7' },
);

export const CreateConversationRequestJsonSchema = z.toJSONSchema(
  CreateConversationRequestSchema,
  { target: 'draft-7' },
);

export const CreateConversationMessageRequestJsonSchema = z.toJSONSchema(
  CreateConversationMessageRequestSchema,
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

export const PersonalTaskListQueryJsonSchema = z.toJSONSchema(
  PersonalTaskListQuerySchema,
  { target: 'draft-7' },
);

export const PersonalTaskResponseJsonSchema = z.toJSONSchema(
  PersonalTaskResponseSchema,
  { target: 'draft-7' },
);

export const PersonalTasksResponseJsonSchema = z.toJSONSchema(
  PersonalTasksResponseSchema,
  { target: 'draft-7' },
);

export const ReminderListQueryJsonSchema = z.toJSONSchema(
  ReminderListQuerySchema,
  { target: 'draft-7' },
);

export const ReminderResponseJsonSchema = z.toJSONSchema(
  ReminderResponseSchema,
  { target: 'draft-7' },
);

export const RemindersResponseJsonSchema = z.toJSONSchema(
  RemindersResponseSchema,
  { target: 'draft-7' },
);

export const NotificationListQueryJsonSchema = z.toJSONSchema(
  NotificationListQuerySchema,
  { target: 'draft-7' },
);

export const NotificationsResponseJsonSchema = z.toJSONSchema(
  NotificationsResponseSchema,
  { target: 'draft-7' },
);

export const ApprovalDecisionRequestJsonSchema = z.toJSONSchema(
  ApprovalDecisionRequestSchema,
  { target: 'draft-7' },
);

export const ChangeApplicationResponseJsonSchema = z.toJSONSchema(
  ChangeApplicationResponseSchema,
  { target: 'draft-7' },
);

export const ChangeApplicationEventsResponseJsonSchema = z.toJSONSchema(
  ChangeApplicationEventsResponseSchema,
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

export const ProjectResponseJsonSchema = z.toJSONSchema(ProjectResponseSchema, {
  target: 'draft-7',
});

export const ProjectsResponseJsonSchema = z.toJSONSchema(
  ProjectsResponseSchema,
  { target: 'draft-7' },
);

export const ConversationResponseJsonSchema = z.toJSONSchema(
  ConversationResponseSchema,
  { target: 'draft-7' },
);

export const ConversationsResponseJsonSchema = z.toJSONSchema(
  ConversationsResponseSchema,
  { target: 'draft-7' },
);

export const ArtifactResponseJsonSchema = z.toJSONSchema(
  ArtifactResponseSchema,
  { target: 'draft-7' },
);

export const CapabilityCatalogJsonSchema = z.toJSONSchema(
  CapabilityCatalogSchema,
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
          'planning_capability_unavailable',
          'software_change_capability_unavailable',
          'capability_unavailable',
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
