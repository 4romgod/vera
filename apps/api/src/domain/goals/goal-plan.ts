import { z } from 'zod';

import { ArtifactReferenceSchema } from '../artifacts/artifact.ts';
import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  AttachmentAnalysisArgumentsSchema,
  findCapability,
} from '../capabilities/capability-registry.ts';
import { PersonalTaskActionArgumentsSchema } from '../personal-tasks/personal-task.ts';
import { ReminderActionArgumentsSchema } from '../reminders/reminder.ts';
import { MemoryActionArgumentsSchema } from '../memories/memory.ts';
import {
  MachineInspectionArgumentsSchema,
  MachineServiceActionArgumentsSchema,
} from '../machines/machine.ts';
import { KnowledgeActionArgumentsSchema } from '../knowledge/knowledge.ts';
import { WorkItemActionArgumentsSchema } from '../work-items/work-item.ts';

export const GoalStepBaseSchema = z.object({
  id: z.string().regex(/^step_[a-z0-9_]+$/u),
  purpose: z.string().trim().min(1).max(500),
  inputStepIds: z.array(z.string().regex(/^step_[a-z0-9_]+$/u)).max(2),
});

export const DevelopmentPlanningGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('development_planning'),
  version: z.literal(1),
  arguments: DevelopmentPlanningProposalArgumentsSchema,
}).strict();
export const WorkItemManagementGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('work_item_management'),
  version: z.literal(1),
  arguments: WorkItemActionArgumentsSchema,
}).strict();
export const SoftwareChangeGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('software_change'),
  version: z.literal(1),
  arguments: SoftwareChangeProposalArgumentsSchema,
}).strict();
export const WebResearchGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('web_research'),
  version: z.literal(1),
  arguments: WebResearchProposalArgumentsSchema,
}).strict();
export const AttachmentAnalysisGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('attachment_analysis'),
  version: z.literal(1),
  arguments: AttachmentAnalysisArgumentsSchema,
}).strict();
export const PersonalTaskManagementGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('personal_task_management'),
  version: z.literal(1),
  arguments: PersonalTaskActionArgumentsSchema,
}).strict();
export const PersonalReminderManagementGoalStepSchema =
  GoalStepBaseSchema.extend({
    capability: z.literal('personal_reminder_management'),
    version: z.literal(1),
    arguments: ReminderActionArgumentsSchema,
  }).strict();
export const MemoryManagementGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('memory_management'),
  version: z.literal(1),
  arguments: MemoryActionArgumentsSchema,
}).strict();
export const KnowledgeManagementGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('knowledge_management'),
  version: z.literal(1),
  arguments: KnowledgeActionArgumentsSchema,
}).strict();
export const MachineInspectionGoalStepSchema = GoalStepBaseSchema.extend({
  capability: z.literal('machine_inspection'),
  version: z.literal(1),
  arguments: MachineInspectionArgumentsSchema,
}).strict();
export const MachineServiceManagementGoalStepSchema = GoalStepBaseSchema.extend(
  {
    capability: z.literal('machine_service_management'),
    version: z.literal(1),
    arguments: MachineServiceActionArgumentsSchema,
  },
).strict();

export const GoalStepSchema = z.discriminatedUnion('capability', [
  WorkItemManagementGoalStepSchema,
  DevelopmentPlanningGoalStepSchema,
  SoftwareChangeGoalStepSchema,
  WebResearchGoalStepSchema,
  PersonalTaskManagementGoalStepSchema,
  PersonalReminderManagementGoalStepSchema,
  MemoryManagementGoalStepSchema,
  KnowledgeManagementGoalStepSchema,
  AttachmentAnalysisGoalStepSchema,
  MachineInspectionGoalStepSchema,
  MachineServiceManagementGoalStepSchema,
]);

export const GoalPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    objective: z.string().trim().min(1).max(10_000),
    summary: z.string().trim().min(1).max(1_000),
    steps: z.array(GoalStepSchema).min(2).max(3),
  })
  .strict()
  .superRefine((plan, context) => {
    const seen = new Map<string, (typeof plan.steps)[number]>();
    for (const step of plan.steps) {
      if (seen.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['steps'],
          message: `Goal step ${step.id} is duplicated.`,
        });
      }
      for (const dependencyId of step.inputStepIds) {
        const dependency = seen.get(dependencyId);
        if (dependency === undefined) {
          context.addIssue({
            code: 'custom',
            path: ['steps'],
            message: `Goal step ${step.id} depends on a missing or later step ${dependencyId}.`,
          });
          continue;
        }
        const capability = findCapability(step.capability, step.version);
        const dependencyCapability = findCapability(
          dependency.capability,
          dependency.version,
        );
        if (
          capability !== undefined &&
          dependencyCapability !== undefined &&
          !capability.acceptedInputArtifacts.includes(
            dependencyCapability.artifact.type,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['steps'],
            message: `${step.capability}@${String(step.version)} does not accept ${dependencyCapability.artifact.type} from ${dependency.id}.`,
          });
        }
      }
      seen.set(step.id, step);
    }
  });

const GoalExecutionFields = {
  status: z.enum([
    'pending',
    'awaiting_approval',
    'executing',
    'succeeded',
    'rejected',
    'failed',
    'cancelled',
  ]),
  approvalId: z.string().startsWith('approval_').optional(),
  invocationId: z.string().startsWith('invocation_').optional(),
  artifact: ArtifactReferenceSchema.optional(),
};

export const GoalExecutionStepSchema = z.discriminatedUnion('capability', [
  WorkItemManagementGoalStepSchema.extend(GoalExecutionFields).strict(),
  DevelopmentPlanningGoalStepSchema.extend(GoalExecutionFields).strict(),
  SoftwareChangeGoalStepSchema.extend(GoalExecutionFields).strict(),
  WebResearchGoalStepSchema.extend(GoalExecutionFields).strict(),
  PersonalTaskManagementGoalStepSchema.extend(GoalExecutionFields).strict(),
  PersonalReminderManagementGoalStepSchema.extend(GoalExecutionFields).strict(),
  MemoryManagementGoalStepSchema.extend(GoalExecutionFields).strict(),
  KnowledgeManagementGoalStepSchema.extend(GoalExecutionFields).strict(),
  AttachmentAnalysisGoalStepSchema.extend(GoalExecutionFields).strict(),
  MachineInspectionGoalStepSchema.extend(GoalExecutionFields).strict(),
  MachineServiceManagementGoalStepSchema.extend(GoalExecutionFields).strict(),
]);

export const FixedGoalExecutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    objective: z.string().trim().min(1).max(10_000),
    summary: z.string().trim().min(1).max(1_000),
    status: z.enum(['active', 'succeeded', 'rejected', 'failed', 'cancelled']),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    currentStepIndex: z.number().int().nonnegative().max(2),
    steps: z.array(GoalExecutionStepSchema).min(2).max(3),
  })
  .strict();

export const GoalExecutionSchema = FixedGoalExecutionSchema;

export type GoalPlan = z.infer<typeof GoalPlanSchema>;
export type GoalExecution = z.infer<typeof GoalExecutionSchema>;
