import { z } from 'zod';

import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  AttachmentAnalysisArgumentsSchema,
} from '../capabilities/capability-registry.ts';
import { PersonalTaskActionArgumentsSchema } from '../personal-tasks/personal-task.ts';
import { ReminderActionArgumentsSchema } from '../reminders/reminder.ts';
import { MemoryActionArgumentsSchema } from '../memories/memory.ts';
import {
  DevelopmentPlanningGoalStepSchema,
  GoalPlanSchema,
  GoalStepSchema,
  SoftwareChangeGoalStepSchema,
  WebResearchGoalStepSchema,
  PersonalTaskManagementGoalStepSchema,
  PersonalReminderManagementGoalStepSchema,
  MemoryManagementGoalStepSchema,
  AttachmentAnalysisGoalStepSchema,
} from '../goals/goal-plan.ts';
import type { CapabilityReference } from '../capabilities/capability-registry.ts';
import { AdaptiveGoalPlanSchema } from '../goals/adaptive-goal.ts';

const DecisionSummarySchema = z.string().trim().min(1).max(500);

const CapabilityReferenceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    version: z.number().int().positive(),
  })
  .strict();

const RespondProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('respond'),
    decisionSummary: DecisionSummarySchema,
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();

const DevelopmentPlanningProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('development_planning'),
      version: z.literal(1),
    }),
    arguments: DevelopmentPlanningProposalArgumentsSchema,
  })
  .strict();

const SoftwareChangeProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('software_change'),
      version: z.literal(1),
    }),
    arguments: SoftwareChangeProposalArgumentsSchema,
  })
  .strict();

const WebResearchProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('web_research'),
      version: z.literal(1),
    }),
    arguments: WebResearchProposalArgumentsSchema,
  })
  .strict();

const AttachmentAnalysisProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('attachment_analysis'),
      version: z.literal(1),
    }),
    arguments: AttachmentAnalysisArgumentsSchema,
  })
  .strict();

const PersonalTaskManagementProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('personal_task_management'),
      version: z.literal(1),
    }),
    arguments: PersonalTaskActionArgumentsSchema,
  })
  .strict();

const PersonalReminderManagementProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('personal_reminder_management'),
      version: z.literal(1),
    }),
    arguments: ReminderActionArgumentsSchema,
  })
  .strict();

const MemoryManagementProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('invoke_capability'),
    decisionSummary: DecisionSummarySchema,
    capability: CapabilityReferenceSchema.extend({
      name: z.literal('memory_management'),
      version: z.literal(1),
    }),
    arguments: MemoryActionArgumentsSchema,
  })
  .strict();

const ExecuteGoalProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('execute_goal'),
    decisionSummary: DecisionSummarySchema,
    goal: GoalPlanSchema,
  })
  .strict();

const PursueAdaptiveGoalProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('pursue_goal'),
    decisionSummary: DecisionSummarySchema,
    goal: AdaptiveGoalPlanSchema,
  })
  .strict();

export const ModelProposalSchema = z.union([
  RespondProposalSchema,
  DevelopmentPlanningProposalSchema,
  SoftwareChangeProposalSchema,
  WebResearchProposalSchema,
  AttachmentAnalysisProposalSchema,
  PersonalTaskManagementProposalSchema,
  PersonalReminderManagementProposalSchema,
  MemoryManagementProposalSchema,
  ExecuteGoalProposalSchema,
  PursueAdaptiveGoalProposalSchema,
]);

export type ModelProposal = z.infer<typeof ModelProposalSchema>;

export function createModelProposalSchema(options: {
  enabledCapabilities: readonly CapabilityReference[];
  allowAdaptiveGoals?: boolean;
}): z.ZodType<ModelProposal> {
  const developmentPlanningEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'development_planning' && capability.version === 1,
  );
  const softwareChangeEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'software_change' && capability.version === 1,
  );
  const webResearchEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'web_research' && capability.version === 1,
  );
  const attachmentAnalysisEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'attachment_analysis' && capability.version === 1,
  );
  const personalTaskManagementEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'personal_task_management' &&
      capability.version === 1,
  );
  const personalReminderManagementEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'personal_reminder_management' &&
      capability.version === 1,
  );
  const memoryManagementEnabled = options.enabledCapabilities.some(
    (capability) =>
      capability.name === 'memory_management' && capability.version === 1,
  );
  const enabledGoalSteps = [
    ...(developmentPlanningEnabled ? [DevelopmentPlanningGoalStepSchema] : []),
    ...(softwareChangeEnabled ? [SoftwareChangeGoalStepSchema] : []),
    ...(webResearchEnabled ? [WebResearchGoalStepSchema] : []),
    ...(personalTaskManagementEnabled
      ? [PersonalTaskManagementGoalStepSchema]
      : []),
    ...(personalReminderManagementEnabled
      ? [PersonalReminderManagementGoalStepSchema]
      : []),
    ...(memoryManagementEnabled ? [MemoryManagementGoalStepSchema] : []),
    ...(attachmentAnalysisEnabled ? [AttachmentAnalysisGoalStepSchema] : []),
  ];
  const schemas: z.ZodType[] = [RespondProposalSchema];
  if (developmentPlanningEnabled) {
    schemas.push(DevelopmentPlanningProposalSchema);
  }
  if (softwareChangeEnabled) schemas.push(SoftwareChangeProposalSchema);
  if (webResearchEnabled) schemas.push(WebResearchProposalSchema);
  if (attachmentAnalysisEnabled) schemas.push(AttachmentAnalysisProposalSchema);
  if (personalTaskManagementEnabled) {
    schemas.push(PersonalTaskManagementProposalSchema);
  }
  if (personalReminderManagementEnabled) {
    schemas.push(PersonalReminderManagementProposalSchema);
  }
  if (memoryManagementEnabled) schemas.push(MemoryManagementProposalSchema);
  if (enabledGoalSteps.length >= 2) {
    const enabledGoalStepSchema = z.union(
      enabledGoalSteps as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
    ) as unknown as typeof GoalStepSchema;
    const enabledGoalPlanSchema = z
      .object({
        schemaVersion: z.literal(1),
        objective: z.string().trim().min(1).max(10_000),
        summary: z.string().trim().min(1).max(1_000),
        steps: z.array(enabledGoalStepSchema).min(2).max(3),
      })
      .strict()
      .superRefine((plan, context) => {
        const validation = GoalPlanSchema.safeParse(plan);
        if (!validation.success) {
          for (const issue of validation.error.issues) {
            context.addIssue({
              code: 'custom',
              path: issue.path,
              message: issue.message,
            });
          }
        }
      });
    schemas.push(
      ExecuteGoalProposalSchema.extend({
        goal: enabledGoalPlanSchema,
      }),
    );
  }
  if (enabledGoalSteps.length >= 1 && options.allowAdaptiveGoals !== false) {
    const firstEnabledGoalStep = enabledGoalSteps[0];
    if (firstEnabledGoalStep === undefined) {
      throw new Error('Adaptive goals require an enabled capability schema.');
    }
    const enabledGoalStepSchema =
      enabledGoalSteps.length === 1
        ? firstEnabledGoalStep
        : z.union(
            enabledGoalSteps as unknown as [
              z.ZodType,
              z.ZodType,
              ...z.ZodType[],
            ],
          );
    schemas.push(
      PursueAdaptiveGoalProposalSchema.extend({
        goal: z
          .object({
            schemaVersion: z.literal(1),
            objective: z.string().trim().min(1).max(10_000),
            summary: z.string().trim().min(1).max(1_000),
            completionCriteria: z.string().trim().min(1).max(2_000),
            requirements: AdaptiveGoalPlanSchema.shape.requirements,
            firstStep: enabledGoalStepSchema,
          })
          .strict()
          .superRefine((plan, context) => {
            const validation = AdaptiveGoalPlanSchema.safeParse(plan);
            if (!validation.success) {
              for (const issue of validation.error.issues) {
                context.addIssue({
                  code: 'custom',
                  path: issue.path,
                  message: issue.message,
                });
              }
            }
          }),
      }),
    );
  }
  if (schemas.length === 1) return RespondProposalSchema;
  return z.union(
    schemas as [z.ZodType, z.ZodType, ...z.ZodType[]],
  ) as z.ZodType<ModelProposal>;
}

export const ModelProposalJsonSchema = z.toJSONSchema(ModelProposalSchema, {
  target: 'draft-7',
});
