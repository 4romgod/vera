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
import { ModelProposalSchema } from './model-proposal.ts';
import { GoalPlanSchema } from '../goals/goal-plan.ts';
import { AdaptiveGoalPlanSchema } from '../goals/adaptive-goal.ts';
import {
  MachineInspectionArgumentsSchema,
  MachineServiceActionArgumentsSchema,
} from '../machines/machine.ts';
import { MissionProposalArgumentsSchema } from '../missions/mission.ts';
import { KnowledgeActionArgumentsSchema } from '../knowledge/knowledge.ts';
import { AttentionActionArgumentsSchema } from '../attention/attention.ts';
import { RoutineManagementArgumentsSchema } from '../routines/routine.ts';

const ResponseDecisionSchema = z
  .object({
    kind: z.literal('respond'),
    message: z.string(),
  })
  .strict();

const AttentionManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('attention_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: AttentionActionArgumentsSchema,
  })
  .strict();

const RoutineManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({ name: z.literal('routine_management'), version: z.literal(1) })
      .strict(),
    proposedArguments: RoutineManagementArgumentsSchema,
  })
  .strict();

const MissionManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({ name: z.literal('mission_management'), version: z.literal(1) })
      .strict(),
    proposedArguments: MissionProposalArgumentsSchema,
  })
  .strict();

const DevelopmentPlanningApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('development_planning'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: DevelopmentPlanningProposalArgumentsSchema,
  })
  .strict();

const SoftwareChangeApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('software_change'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: SoftwareChangeProposalArgumentsSchema,
  })
  .strict();

const WebResearchApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('web_research'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: WebResearchProposalArgumentsSchema,
  })
  .strict();

const AttachmentAnalysisApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('attachment_analysis'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: AttachmentAnalysisArgumentsSchema,
  })
  .strict();

const PersonalTaskManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('personal_task_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: PersonalTaskActionArgumentsSchema,
  })
  .strict();

const PersonalReminderManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('personal_reminder_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: ReminderActionArgumentsSchema,
  })
  .strict();

const MemoryManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('memory_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: MemoryActionArgumentsSchema,
  })
  .strict();

const KnowledgeManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('knowledge_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: KnowledgeActionArgumentsSchema,
  })
  .strict();

const MachineInspectionApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({ name: z.literal('machine_inspection'), version: z.literal(1) })
      .strict(),
    proposedArguments: MachineInspectionArgumentsSchema,
  })
  .strict();

const MachineServiceManagementApprovalDecisionSchema = z
  .object({
    kind: z.literal('approval_required'),
    reason: z.literal('specialist_capability_invocation'),
    capability: z
      .object({
        name: z.literal('machine_service_management'),
        version: z.literal(1),
      })
      .strict(),
    proposedArguments: MachineServiceActionArgumentsSchema,
  })
  .strict();

const RejectedProposalDecisionSchema = z
  .object({
    kind: z.literal('rejected'),
    code: z.enum([
      'invalid_model_output',
      'unknown_capability',
      'invalid_capability_arguments',
      'invalid_goal_plan',
    ]),
    message: z.string(),
  })
  .strict();

const GoalPlannedDecisionSchema = z
  .object({
    kind: z.literal('goal_planned'),
    plan: GoalPlanSchema,
  })
  .strict();

const AdaptiveGoalPlannedDecisionSchema = z
  .object({
    kind: z.literal('adaptive_goal_planned'),
    plan: AdaptiveGoalPlanSchema,
  })
  .strict();

export const ExecutionDecisionSchema = z.union([
  ResponseDecisionSchema,
  RoutineManagementApprovalDecisionSchema,
  AttentionManagementApprovalDecisionSchema,
  MissionManagementApprovalDecisionSchema,
  DevelopmentPlanningApprovalDecisionSchema,
  SoftwareChangeApprovalDecisionSchema,
  WebResearchApprovalDecisionSchema,
  AttachmentAnalysisApprovalDecisionSchema,
  PersonalTaskManagementApprovalDecisionSchema,
  PersonalReminderManagementApprovalDecisionSchema,
  MemoryManagementApprovalDecisionSchema,
  KnowledgeManagementApprovalDecisionSchema,
  MachineInspectionApprovalDecisionSchema,
  MachineServiceManagementApprovalDecisionSchema,
  GoalPlannedDecisionSchema,
  AdaptiveGoalPlannedDecisionSchema,
  RejectedProposalDecisionSchema,
]);

export const DecisionResultSchema = z
  .object({
    decisionId: z.string().startsWith('decision_'),
    proposal: ModelProposalSchema.nullable(),
    decision: ExecutionDecisionSchema,
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
      .strict(),
  })
  .strict();

export type ExecutionDecision = z.infer<typeof ExecutionDecisionSchema>;
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

export const DecisionResultJsonSchema = z.toJSONSchema(DecisionResultSchema, {
  target: 'draft-7',
});
