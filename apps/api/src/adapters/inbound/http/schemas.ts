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
  MemoryResultArtifactSchema,
  AttachmentAnalysisArtifactSchema,
  MachineDiagnosticArtifactSchema,
  MachineServiceActionResultArtifactSchema,
  MissionManagementResultArtifactSchema,
  KnowledgeResultArtifactSchema,
  AttentionResultArtifactSchema,
  RoutineManagementResultArtifactSchema,
  SoftwareDeliveryManagementResultArtifactSchema,
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
import {
  SoftwareChangePublicationEventSchema,
  SoftwareChangePublicationSchema,
} from '../../../domain/changes/software-change-publication.ts';
import { GoalExecutionSchema } from '../../../domain/goals/goal-plan.ts';
import { AdaptiveGoalExecutionSchema } from '../../../domain/goals/adaptive-goal.ts';
import { PersonalTaskResourceSchema } from '../../../domain/personal-tasks/personal-task.ts';
import {
  NotificationResourceSchema,
  ReminderResourceSchema,
  ReminderStatusSchema,
} from '../../../domain/reminders/reminder.ts';
import {
  MemoryKindSchema,
  MemoryResourceSchema,
} from '../../../domain/memories/memory.ts';
import { MemoryContextManifestSchema } from '../../../domain/memories/memory-context.ts';
import { ExternalSignalContextManifestSchema } from '../../../domain/external-awareness/external-signal-context.ts';
import {
  AttachmentReferenceSchema,
  AttachmentResponseSchema,
} from '../../../domain/attachments/attachment.ts';
import {
  KnowledgeSearchResponseSchema,
  KnowledgeSourceResourceSchema,
} from '../../../domain/knowledge/knowledge.ts';
import {
  AttentionBriefingSchema,
  AttentionDecisionRequestSchema,
} from '../../../domain/attention/attention.ts';
import {
  NotificationDeviceRegistrationSchema,
  NotificationDeviceResponseSchema,
  PushDeliverySchema,
  PushPreferencesSchema,
} from '../../../domain/notifications/push-notification.ts';

export const EvaluateRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export type AttentionDecisionRequest = z.infer<
  typeof AttentionDecisionRequestSchema
>;

export const SubmitTaskRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
    projectId: z.string().startsWith('project_').optional(),
    attachmentIds: z
      .array(z.string().startsWith('attachment_'))
      .max(5)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
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
    attachmentIds: z
      .array(z.string().startsWith('attachment_'))
      .max(5)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
  })
  .strict();

export type CreateConversationMessageRequest = z.infer<
  typeof CreateConversationMessageRequestSchema
>;

export const HandleExternalSignalRequestSchema = z
  .object({
    objective: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export type HandleExternalSignalRequest = z.infer<
  typeof HandleExternalSignalRequestSchema
>;

export const AttachmentUploadHeadersSchema = z.looseObject({
  'content-type': z.string().min(1).max(200),
  'x-vera-filename': z.string().trim().min(1).max(1_000),
  'x-vera-media-type': z.string().trim().min(1).max(200),
});
export type AttachmentUploadHeaders = z.infer<
  typeof AttachmentUploadHeadersSchema
>;

export const AttachmentResponseJsonSchema = z.toJSONSchema(
  AttachmentResponseSchema,
  { target: 'draft-7' },
);
export const AttachmentUploadHeadersJsonSchema = z.toJSONSchema(
  AttachmentUploadHeadersSchema,
  { target: 'draft-7' },
);

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

export const CreateSoftwareChangePublicationRequestSchema = z
  .object({
    baseBranch: z.string().trim().min(1).max(200).default('main'),
    commitMessage: z.string().trim().min(1).max(5_000),
    pullRequest: z
      .object({
        title: z.string().trim().min(1).max(256),
        body: z.string().max(50_000),
        draft: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export type CreateSoftwareChangePublicationRequest = z.infer<
  typeof CreateSoftwareChangePublicationRequestSchema
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

export const ChangeApplicationListResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    applications: z.array(ChangeApplicationResponseSchema).max(20),
  })
  .strict();

export const SoftwareChangePublicationResponseSchema =
  SoftwareChangePublicationSchema.omit({
    principalId: true,
    requestKey: true,
    events: true,
  }).extend({
    links: z
      .object({
        publication: z.string(),
        events: z.string(),
        decision: z.string().optional(),
        cancellation: z.string().optional(),
      })
      .strict(),
  });

export const SoftwareChangePublicationEventsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicationId: z.string().startsWith('publication_'),
    events: z.array(SoftwareChangePublicationEventSchema),
  })
  .strict();

export const SoftwareChangePublicationListResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    publications: z.array(SoftwareChangePublicationResponseSchema).max(20),
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
    attachments: z.array(AttachmentReferenceSchema).max(5).optional(),
    externalSignal: z
      .object({
        id: z.string().startsWith('external_signal_'),
        version: z.number().int().positive(),
      })
      .strict()
      .optional(),
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
    memoryContextManifest: MemoryContextManifestSchema.optional(),
    externalSignalContextManifest:
      ExternalSignalContextManifestSchema.optional(),
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
        externalSignal: z.string().optional(),
        externalSignalResolution: z.string().optional(),
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
  MemoryResultArtifactSchema.omit({ principalId: true }),
  AttachmentAnalysisArtifactSchema.omit({ principalId: true }),
  MachineDiagnosticArtifactSchema.omit({ principalId: true }),
  MachineServiceActionResultArtifactSchema.omit({ principalId: true }),
  MissionManagementResultArtifactSchema.omit({ principalId: true }),
  KnowledgeResultArtifactSchema.omit({ principalId: true }),
  AttentionResultArtifactSchema.omit({ principalId: true }),
  RoutineManagementResultArtifactSchema.omit({ principalId: true }),
  SoftwareDeliveryManagementResultArtifactSchema.omit({ principalId: true }),
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

export const MemoryListQuerySchema = z
  .object({
    status: z.enum(['active', 'all']).optional(),
    kind: MemoryKindSchema.optional(),
    scopeKind: z.enum(['global', 'project']).optional(),
    projectId: z.string().startsWith('project_').optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeKind === 'project' && value.projectId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId is required for project memory scope.',
      });
    }
    if (value.scopeKind !== 'project' && value.projectId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId requires scopeKind=project.',
      });
    }
  });

export type MemoryListQuery = z.infer<typeof MemoryListQuerySchema>;

export const MemoryResponseSchema = MemoryResourceSchema;
export const MemoriesResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    memories: z.array(MemoryResourceSchema).max(100),
  })
  .strict();

export const CreateKnowledgeSourceRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('global') }).strict(),
      z
        .object({
          kind: z.literal('project'),
          projectId: z.string().startsWith('project_'),
        })
        .strict(),
    ]),
    sensitivity: z.enum(['personal', 'sensitive']).optional(),
    attachmentIds: z
      .array(z.string().startsWith('attachment_'))
      .min(1)
      .max(5)
      .refine((values) => new Set(values).size === values.length),
    analysisArtifactId: z.string().startsWith('artifact_').optional(),
  })
  .strict();

export const KnowledgeListQuerySchema = z
  .object({
    status: z.enum(['active', 'all']).optional(),
    scopeKind: z.enum(['global', 'project']).optional(),
    projectId: z.string().startsWith('project_').optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeKind === 'project' && value.projectId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId is required for project knowledge scope.',
      });
    }
    if (value.scopeKind !== 'project' && value.projectId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId requires scopeKind=project.',
      });
    }
  });

export const KnowledgeSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    scope: CreateKnowledgeSourceRequestSchema.shape.scope.optional(),
    limit: z.number().int().positive().max(12).optional(),
  })
  .strict();

export const KnowledgeSourceResponseSchema = KnowledgeSourceResourceSchema;
export const KnowledgeSourcesResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z.array(KnowledgeSourceResourceSchema).max(100),
  })
  .strict();

export type CreateKnowledgeSourceRequest = z.infer<
  typeof CreateKnowledgeSourceRequestSchema
>;
export type KnowledgeListQuery = z.infer<typeof KnowledgeListQuerySchema>;
export type KnowledgeSearchRequest = z.infer<
  typeof KnowledgeSearchRequestSchema
>;

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const ErrorResponseJsonSchema = z.toJSONSchema(ErrorResponseSchema, {
  target: 'draft-7',
});

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
export const MemoryListQueryJsonSchema = z.toJSONSchema(MemoryListQuerySchema, {
  target: 'draft-7',
});
export const MemoryResponseJsonSchema = z.toJSONSchema(MemoryResponseSchema, {
  target: 'draft-7',
});
export const MemoriesResponseJsonSchema = z.toJSONSchema(
  MemoriesResponseSchema,
  { target: 'draft-7' },
);
export const CreateKnowledgeSourceRequestJsonSchema = z.toJSONSchema(
  CreateKnowledgeSourceRequestSchema,
  { target: 'draft-7' },
);
export const KnowledgeListQueryJsonSchema = z.toJSONSchema(
  KnowledgeListQuerySchema,
  { target: 'draft-7' },
);
export const KnowledgeSearchRequestJsonSchema = z.toJSONSchema(
  KnowledgeSearchRequestSchema,
  { target: 'draft-7' },
);
export const KnowledgeSourceResponseJsonSchema = z.toJSONSchema(
  KnowledgeSourceResponseSchema,
  { target: 'draft-7' },
);
export const KnowledgeSourcesResponseJsonSchema = z.toJSONSchema(
  KnowledgeSourcesResponseSchema,
  { target: 'draft-7' },
);
export const KnowledgeSearchResponseJsonSchema = z.toJSONSchema(
  KnowledgeSearchResponseSchema,
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

export const ChangeApplicationListResponseJsonSchema = z.toJSONSchema(
  ChangeApplicationListResponseSchema,
  { target: 'draft-7' },
);

export const CreateSoftwareChangePublicationRequestJsonSchema = z.toJSONSchema(
  CreateSoftwareChangePublicationRequestSchema,
  { target: 'draft-7' },
);

export const SoftwareChangePublicationResponseJsonSchema = z.toJSONSchema(
  SoftwareChangePublicationResponseSchema,
  { target: 'draft-7' },
);

export const SoftwareChangePublicationEventsResponseJsonSchema = z.toJSONSchema(
  SoftwareChangePublicationEventsResponseSchema,
  { target: 'draft-7' },
);

export const SoftwareChangePublicationListResponseJsonSchema = z.toJSONSchema(
  SoftwareChangePublicationListResponseSchema,
  { target: 'draft-7' },
);

export const TaskLifecycleResponseJsonSchema = z.toJSONSchema(
  TaskLifecycleResponseSchema,
  { target: 'draft-7' },
);

export const HandleExternalSignalRequestJsonSchema = z.toJSONSchema(
  HandleExternalSignalRequestSchema,
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

export const SpeechTranscriptionResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    text: z.string().trim().min(1).max(100_000),
    provider: z.string().min(1),
    model: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export const SpeechTranscriptionResponseJsonSchema = z.toJSONSchema(
  SpeechTranscriptionResponseSchema,
  { target: 'draft-7' },
);

export const AttentionBriefingJsonSchema = z.toJSONSchema(
  AttentionBriefingSchema,
  { target: 'draft-7' },
);

export const AttentionDecisionRequestJsonSchema = z.toJSONSchema(
  AttentionDecisionRequestSchema,
  { target: 'draft-7' },
);

export const NotificationDeviceRegistrationJsonSchema = z.toJSONSchema(
  NotificationDeviceRegistrationSchema,
  { target: 'draft-7' },
);
export const PushPreferencesJsonSchema = z.toJSONSchema(PushPreferencesSchema, {
  target: 'draft-7',
});
export const NotificationDeviceJsonSchema = z.toJSONSchema(
  NotificationDeviceResponseSchema,
  { target: 'draft-7' },
);
export const NotificationDeviceListJsonSchema = z.toJSONSchema(
  z
    .object({
      schemaVersion: z.literal(1),
      devices: z.array(NotificationDeviceResponseSchema),
    })
    .strict(),
  { target: 'draft-7' },
);
const PublicPushDeliverySchema = PushDeliverySchema.omit({
  principalId: true,
  providerTicketId: true,
});
export const PushDeliveryJsonSchema = z.toJSONSchema(PublicPushDeliverySchema, {
  target: 'draft-7',
});
export const PushDeliveryListJsonSchema = z.toJSONSchema(
  z
    .object({
      schemaVersion: z.literal(1),
      deliveries: z.array(PublicPushDeliverySchema),
    })
    .strict(),
  { target: 'draft-7' },
);
export const PushNotificationStatusJsonSchema = z.toJSONSchema(
  z
    .object({
      schemaVersion: z.literal(1),
      enabled: z.boolean(),
      provider: z.string().optional(),
      projectId: z.string().optional(),
    })
    .strict(),
  { target: 'draft-7' },
);
