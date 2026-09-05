import { z } from 'zod';

import { DevelopmentPlanSchema } from '../plans/development-plan.ts';
import { CapabilityDestinationSchema } from '../capabilities/capability-destination.ts';
import { SoftwareChangeSchema } from '../changes/software-change.ts';
import { ResearchReportSchema } from '../research/research-report.ts';
import { PersonalTaskResultSchema } from '../personal-tasks/personal-task.ts';
import { ReminderResultSchema } from '../reminders/reminder.ts';
import { MemoryResultSchema } from '../memories/memory.ts';
import { AttachmentAnalysisSchema } from '../attachments/attachment-analysis.ts';
import {
  MachineDiagnosticSchema,
  MachineServiceActionResultSchema,
} from '../machines/machine.ts';
import { MissionManagementResultSchema } from '../missions/mission.ts';
import { KnowledgeResultSchema } from '../knowledge/knowledge.ts';
import { AttentionResultSchema } from '../attention/attention.ts';
import { RoutineManagementResultSchema } from '../routines/routine.ts';
import { SoftwareDeliveryManagementResultSchema } from '../software-delivery/software-delivery-management.ts';
import { WorkItemResultSchema } from '../work-items/work-item.ts';

export const ArtifactLineageReferenceSchema = z
  .object({
    id: z.string().startsWith('artifact_'),
    version: z.literal(1),
    type: z.enum([
      'implementation_plan',
      'software_change',
      'research_report',
      'personal_task_result',
      'personal_reminder_result',
      'memory_result',
      'attachment_analysis',
      'machine_diagnostic',
      'machine_service_action_result',
      'mission_management_result',
      'knowledge_result',
      'attention_result',
      'routine_management_result',
      'software_delivery_management_result',
      'work_item_result',
    ]),
    mediaType: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

const ArtifactProducerSchema = z
  .object({
    destination: CapabilityDestinationSchema.optional(),
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
  .strict();

const ArtifactIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('artifact_'),
    version: z.literal(1),
    principalId: z.string().min(1),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    invocationId: z.string().startsWith('invocation_'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    producer: ArtifactProducerSchema,
    inputs: z.array(ArtifactLineageReferenceSchema).max(2).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const ImplementationPlanArtifactSchema = ArtifactIdentitySchema.extend({
  projectId: z.string().startsWith('project_'),
  type: z.literal('implementation_plan'),
  mediaType: z.literal('application/vnd.vera.implementation-plan+json'),
  content: DevelopmentPlanSchema,
}).strict();

export const SoftwareChangeArtifactSchema = ArtifactIdentitySchema.extend({
  projectId: z.string().startsWith('project_'),
  type: z.literal('software_change'),
  mediaType: z.literal('application/vnd.vera.software-change+json'),
  content: SoftwareChangeSchema,
}).strict();

export const ResearchReportArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('research_report'),
  mediaType: z.literal('application/vnd.vera.research-report+json'),
  content: ResearchReportSchema,
}).strict();

export const PersonalTaskResultArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('personal_task_result'),
  mediaType: z.literal('application/vnd.vera.personal-task-result+json'),
  content: PersonalTaskResultSchema,
}).strict();

export const PersonalReminderResultArtifactSchema =
  ArtifactIdentitySchema.extend({
    type: z.literal('personal_reminder_result'),
    mediaType: z.literal('application/vnd.vera.personal-reminder-result+json'),
    content: ReminderResultSchema,
  }).strict();

export const MemoryResultArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('memory_result'),
  mediaType: z.literal('application/vnd.vera.memory-result+json'),
  content: MemoryResultSchema,
}).strict();

export const AttachmentAnalysisArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('attachment_analysis'),
  mediaType: z.literal('application/vnd.vera.attachment-analysis+json'),
  content: AttachmentAnalysisSchema,
}).strict();

export const MachineDiagnosticArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('machine_diagnostic'),
  mediaType: z.literal('application/vnd.vera.machine-diagnostic+json'),
  content: MachineDiagnosticSchema,
}).strict();

export const MachineServiceActionResultArtifactSchema =
  ArtifactIdentitySchema.extend({
    type: z.literal('machine_service_action_result'),
    mediaType: z.literal(
      'application/vnd.vera.machine-service-action-result+json',
    ),
    content: MachineServiceActionResultSchema,
  }).strict();

export const MissionManagementResultArtifactSchema =
  ArtifactIdentitySchema.extend({
    type: z.literal('mission_management_result'),
    mediaType: z.literal('application/vnd.vera.mission-management-result+json'),
    content: MissionManagementResultSchema,
  }).strict();

export const SoftwareDeliveryManagementResultArtifactSchema =
  ArtifactIdentitySchema.extend({
    type: z.literal('software_delivery_management_result'),
    mediaType: z.literal(
      'application/vnd.vera.software-delivery-management-result+json',
    ),
    content: SoftwareDeliveryManagementResultSchema,
  }).strict();

export const KnowledgeResultArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('knowledge_result'),
  mediaType: z.literal('application/vnd.vera.knowledge-result+json'),
  content: KnowledgeResultSchema,
}).strict();

export const AttentionResultArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('attention_result'),
  mediaType: z.literal('application/vnd.vera.attention-result+json'),
  content: AttentionResultSchema,
}).strict();

export const RoutineManagementResultArtifactSchema =
  ArtifactIdentitySchema.extend({
    type: z.literal('routine_management_result'),
    mediaType: z.literal('application/vnd.vera.routine-management-result+json'),
    content: RoutineManagementResultSchema,
  }).strict();

export const WorkItemResultArtifactSchema = ArtifactIdentitySchema.extend({
  projectId: z.string().startsWith('project_'),
  type: z.literal('work_item_result'),
  mediaType: z.literal('application/vnd.vera.work-item-result+json'),
  content: WorkItemResultSchema,
}).strict();

export const ArtifactSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactSchema,
  SoftwareChangeArtifactSchema,
  ResearchReportArtifactSchema,
  PersonalTaskResultArtifactSchema,
  PersonalReminderResultArtifactSchema,
  MemoryResultArtifactSchema,
  AttachmentAnalysisArtifactSchema,
  MachineDiagnosticArtifactSchema,
  MachineServiceActionResultArtifactSchema,
  MissionManagementResultArtifactSchema,
  SoftwareDeliveryManagementResultArtifactSchema,
  KnowledgeResultArtifactSchema,
  AttentionResultArtifactSchema,
  RoutineManagementResultArtifactSchema,
  WorkItemResultArtifactSchema,
]);

const ArtifactReferenceBaseSchema = ArtifactIdentitySchema.pick({
  id: true,
  version: true,
  sha256: true,
  byteLength: true,
});

export const ImplementationPlanArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('implementation_plan'),
    mediaType: z.literal('application/vnd.vera.implementation-plan+json'),
  }).strict();

export const SoftwareChangeArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('software_change'),
    mediaType: z.literal('application/vnd.vera.software-change+json'),
  }).strict();

export const ResearchReportArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('research_report'),
    mediaType: z.literal('application/vnd.vera.research-report+json'),
  }).strict();

export const PersonalTaskResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('personal_task_result'),
    mediaType: z.literal('application/vnd.vera.personal-task-result+json'),
  }).strict();

export const PersonalReminderResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('personal_reminder_result'),
    mediaType: z.literal('application/vnd.vera.personal-reminder-result+json'),
  }).strict();

export const MemoryResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('memory_result'),
    mediaType: z.literal('application/vnd.vera.memory-result+json'),
  }).strict();

export const AttachmentAnalysisArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('attachment_analysis'),
    mediaType: z.literal('application/vnd.vera.attachment-analysis+json'),
  }).strict();

export const MachineDiagnosticArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('machine_diagnostic'),
    mediaType: z.literal('application/vnd.vera.machine-diagnostic+json'),
  }).strict();

export const MachineServiceActionResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('machine_service_action_result'),
    mediaType: z.literal(
      'application/vnd.vera.machine-service-action-result+json',
    ),
  }).strict();

export const MissionManagementResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('mission_management_result'),
    mediaType: z.literal('application/vnd.vera.mission-management-result+json'),
  }).strict();

export const SoftwareDeliveryManagementResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('software_delivery_management_result'),
    mediaType: z.literal(
      'application/vnd.vera.software-delivery-management-result+json',
    ),
  }).strict();

export const KnowledgeResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('knowledge_result'),
    mediaType: z.literal('application/vnd.vera.knowledge-result+json'),
  }).strict();

export const AttentionResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('attention_result'),
    mediaType: z.literal('application/vnd.vera.attention-result+json'),
  }).strict();

export const RoutineManagementResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('routine_management_result'),
    mediaType: z.literal('application/vnd.vera.routine-management-result+json'),
  }).strict();

export const WorkItemResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('work_item_result'),
    mediaType: z.literal('application/vnd.vera.work-item-result+json'),
  }).strict();

export const ArtifactReferenceSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactReferenceSchema,
  SoftwareChangeArtifactReferenceSchema,
  ResearchReportArtifactReferenceSchema,
  PersonalTaskResultArtifactReferenceSchema,
  PersonalReminderResultArtifactReferenceSchema,
  MemoryResultArtifactReferenceSchema,
  AttachmentAnalysisArtifactReferenceSchema,
  MachineDiagnosticArtifactReferenceSchema,
  MachineServiceActionResultArtifactReferenceSchema,
  MissionManagementResultArtifactReferenceSchema,
  SoftwareDeliveryManagementResultArtifactReferenceSchema,
  KnowledgeResultArtifactReferenceSchema,
  AttentionResultArtifactReferenceSchema,
  RoutineManagementResultArtifactReferenceSchema,
  WorkItemResultArtifactReferenceSchema,
]);

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
