import { randomUUID } from 'node:crypto';

import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  findCapability,
  findExplicitAdaptiveOutcomes,
} from '../../domain/capabilities/capability-registry.ts';
import type { ConversationContextBundle } from '../../domain/conversations/conversation-context.ts';
import type {
  DecisionResult,
  ExecutionDecision,
} from '../../domain/model/execution-decision.ts';
import {
  ModelProposalSchema,
  createModelProposalSchema,
  type ModelProposal,
} from '../../domain/model/model-proposal.ts';
import { buildModelSystemPrompt } from './model-system-prompt.ts';
import type { ModelProvider } from '../../ports/model/model-provider.ts';
import type { CapabilityReference } from '../../domain/capabilities/capability-registry.ts';
import { z } from 'zod';
import {
  GoalPlanSchema,
  GoalStepSchema,
} from '../../domain/goals/goal-plan.ts';
import { PersonalTaskActionArgumentsSchema } from '../../domain/personal-tasks/personal-task.ts';
import { ReminderActionArgumentsSchema } from '../../domain/reminders/reminder.ts';
import { MemoryActionArgumentsSchema } from '../../domain/memories/memory.ts';
import {
  AdaptiveGoalPlanSchema,
  AdaptiveGoalRequirementSchema,
} from '../../domain/goals/adaptive-goal.ts';
import type { AdaptiveGoalPlan } from '../../domain/goals/adaptive-goal.ts';

export type EvaluateModelDecision = (
  message: string,
  context?: {
    selectedProject?: { id: string; displayName: string };
    conversationContext?: ConversationContextBundle;
    memoryContext?: import('../../domain/memories/memory-context.ts').MemoryContextBundle;
    temporalContext?: { currentTime?: string; ownerTimeZone?: string };
  },
) => Promise<DecisionResult>;

type AdaptiveRequirement = AdaptiveGoalPlan['requirements'][number];

const RepairableAdaptiveGoalCandidateSchema = z
  .object({
    kind: z.literal('pursue_goal'),
    goal: z
      .object({
        requirements: z.array(AdaptiveGoalRequirementSchema).max(3),
        firstStep: GoalStepSchema,
      })
      .loose(),
  })
  .loose();

function restoreFirstStepRequirement(candidate: unknown): unknown {
  const parsed = RepairableAdaptiveGoalCandidateSchema.safeParse(candidate);
  if (!parsed.success) return candidate;

  const { firstStep, requirements } = parsed.data.goal;
  if (
    requirements.some(
      (requirement) =>
        requirement.capability === firstStep.capability &&
        requirement.version === firstStep.version &&
        requirement.condition.kind === 'always',
    ) ||
    requirements.length >= 3
  ) {
    return candidate;
  }

  const existingIds = new Set(requirements.map(({ id }) => id));
  let id = 'requirement_first_step';
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `requirement_first_step_${String(suffix)}`;
    suffix += 1;
  }

  return {
    ...parsed.data,
    goal: {
      ...parsed.data.goal,
      requirements: [
        {
          id,
          description: firstStep.purpose,
          capability: firstStep.capability,
          version: firstStep.version,
          condition: { kind: 'always' as const },
        },
        ...requirements,
      ],
    },
  };
}

function inferExplicitAdaptiveRequirements(
  ownerMessage: string,
  enabledCapabilities: readonly CapabilityReference[],
): AdaptiveRequirement[] {
  const message = ownerMessage.toLowerCase();
  const conditional = /\b(if|when|unless|depending on|based on)\b/u.test(
    message,
  );
  return findExplicitAdaptiveOutcomes(ownerMessage, enabledCapabilities).map(
    (outcome) => ({
      id: `requirement_explicit_${outcome.capability.name}`,
      description: outcome.description,
      capability: outcome.capability.name,
      version: outcome.capability.version,
      condition: conditional
        ? {
            kind: 'evidence_dependent' as const,
            description:
              'The condition stated in the owner request is supported by validated evidence.',
          }
        : { kind: 'always' as const },
    }),
  );
}

function decide(
  proposal: ModelProposal,
  enabledCapabilities: readonly CapabilityReference[],
  selectedProject?: { id: string; displayName: string },
  ownerTimeZone = 'UTC',
  ownerMessage = '',
): ExecutionDecision {
  if (proposal.kind === 'respond') {
    return { kind: 'respond', message: proposal.message };
  }

  if (proposal.kind === 'execute_goal') {
    const plan = GoalPlanSchema.safeParse(proposal.goal);
    if (!plan.success) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message:
          'The proposed goal plan is invalid or cannot carry its artifacts safely.',
      };
    }
    const unavailable = plan.data.steps.find(
      (step) =>
        !enabledCapabilities.some(
          (capability) =>
            capability.name === step.capability &&
            capability.version === step.version,
        ),
    );
    if (unavailable !== undefined) {
      return {
        kind: 'rejected',
        code: 'unknown_capability',
        message: `Goal step ${unavailable.id} selected an unavailable capability.`,
      };
    }
    const mismatchedProjectStep = plan.data.steps.find(
      (step) =>
        'project' in step.arguments &&
        step.arguments.project.name !== selectedProject?.displayName,
    );
    if (mismatchedProjectStep !== undefined) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message: `Goal step ${mismatchedProjectStep.id} does not preserve the selected project identity.`,
      };
    }
    const mismatchedReminderStep = plan.data.steps.find(
      (step) =>
        step.capability === 'personal_reminder_management' &&
        'timeZone' in step.arguments &&
        step.arguments.timeZone !== ownerTimeZone,
    );
    if (mismatchedReminderStep !== undefined) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message: `Goal step ${mismatchedReminderStep.id} does not preserve the configured owner time zone.`,
      };
    }
    return { kind: 'goal_planned', plan: plan.data };
  }

  if (proposal.kind === 'pursue_goal') {
    const plan = AdaptiveGoalPlanSchema.safeParse(proposal.goal);
    if (!plan.success) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message: 'The proposed adaptive goal is invalid.',
      };
    }
    const explicitRequirements = inferExplicitAdaptiveRequirements(
      ownerMessage,
      enabledCapabilities,
    );
    const requirements = [...plan.data.requirements];
    for (const inferred of explicitRequirements) {
      if (
        !requirements.some(
          (requirement) =>
            requirement.capability === inferred.capability &&
            requirement.version === inferred.version,
        )
      ) {
        const id = requirements.some(
          (requirement) => requirement.id === inferred.id,
        )
          ? `${inferred.id}_owner`
          : inferred.id;
        requirements.push({ ...inferred, id });
      }
    }
    const enrichedPlan = AdaptiveGoalPlanSchema.safeParse({
      ...plan.data,
      requirements,
    });
    if (!enrichedPlan.success) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message:
          'The adaptive goal cannot preserve every explicit owner outcome within its bounded contract.',
      };
    }
    const step = enrichedPlan.data.firstStep;
    const unavailableRequirement = enrichedPlan.data.requirements.find(
      (requirement) =>
        !enabledCapabilities.some(
          (capability) =>
            capability.name === requirement.capability &&
            capability.version === requirement.version,
        ),
    );
    if (unavailableRequirement !== undefined) {
      return {
        kind: 'rejected',
        code: 'unknown_capability',
        message: `Adaptive goal requirement ${unavailableRequirement.id} selected an unavailable capability.`,
      };
    }
    if (
      !enabledCapabilities.some(
        (capability) =>
          capability.name === step.capability &&
          capability.version === step.version,
      )
    ) {
      return {
        kind: 'rejected',
        code: 'unknown_capability',
        message: 'The adaptive goal selected an unavailable first capability.',
      };
    }
    if (
      'project' in step.arguments &&
      step.arguments.project.name !== selectedProject?.displayName
    ) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message:
          'The adaptive goal did not preserve the selected project identity.',
      };
    }
    if (
      step.capability === 'personal_reminder_management' &&
      'timeZone' in step.arguments &&
      step.arguments.timeZone !== ownerTimeZone
    ) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message:
          'The adaptive goal did not preserve the configured owner time zone.',
      };
    }
    return { kind: 'adaptive_goal_planned', plan: enrichedPlan.data };
  }

  const capability = findCapability(
    proposal.capability.name,
    proposal.capability.version,
  );

  if (capability === undefined) {
    return {
      kind: 'rejected',
      code: 'unknown_capability',
      message: `Capability ${proposal.capability.name}@${String(proposal.capability.version)} is not registered.`,
    };
  }

  const validatedArguments = capability.proposalArgumentsSchema.safeParse(
    proposal.arguments,
  );
  if (!validatedArguments.success) {
    return {
      kind: 'rejected',
      code: 'invalid_capability_arguments',
      message:
        'The proposed capability arguments do not satisfy their contract.',
    };
  }

  if (proposal.capability.name === 'development_planning') {
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: DevelopmentPlanningProposalArgumentsSchema.parse(
        proposal.arguments,
      ),
    };
  }
  if (proposal.capability.name === 'software_change') {
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: SoftwareChangeProposalArgumentsSchema.parse(
        proposal.arguments,
      ),
    };
  }
  if (proposal.capability.name === 'personal_task_management') {
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: PersonalTaskActionArgumentsSchema.parse(
        proposal.arguments,
      ),
    };
  }
  if (proposal.capability.name === 'personal_reminder_management') {
    const arguments_ = ReminderActionArgumentsSchema.parse(proposal.arguments);
    if ('timeZone' in arguments_ && arguments_.timeZone !== ownerTimeZone) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed reminder does not preserve the configured owner time zone.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: arguments_,
    };
  }
  if (proposal.capability.name === 'memory_management') {
    const arguments_ = MemoryActionArgumentsSchema.parse(proposal.arguments);
    if (
      'scope' in arguments_ &&
      arguments_.scope?.kind === 'project' &&
      arguments_.scope.projectId !== selectedProject?.id
    ) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed memory scope does not preserve the selected project identity.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: arguments_,
    };
  }
  return {
    kind: 'approval_required',
    reason: 'specialist_capability_invocation',
    capability: proposal.capability,
    proposedArguments: WebResearchProposalArgumentsSchema.parse(
      proposal.arguments,
    ),
  };
}

export function createEvaluateModelDecision(
  provider: ModelProvider,
  createId: () => string = () => `decision_${randomUUID()}`,
  options: {
    enabledCapabilities?: readonly CapabilityReference[];
    ownerTimeZone?: string;
    clock?: () => string;
  } = {},
): EvaluateModelDecision {
  const enabledCapabilities = options.enabledCapabilities ?? [
    { name: 'development_planning', version: 1 },
    { name: 'software_change', version: 1 },
  ];
  const allowAdaptiveGoals = provider.dataBoundary === 'owner_controlled';
  const generationSchema = createModelProposalSchema({
    enabledCapabilities,
    allowAdaptiveGoals,
  });
  const generationJsonSchema = z.toJSONSchema(generationSchema, {
    target: 'draft-7',
  });
  const ownerTimeZone = options.ownerTimeZone ?? 'UTC';
  const clock = options.clock ?? (() => new Date().toISOString());
  return async (message, context) => {
    const temporalContext = {
      currentTime: context?.temporalContext?.currentTime ?? clock(),
      ownerTimeZone: context?.temporalContext?.ownerTimeZone ?? ownerTimeZone,
    };
    const generation = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: buildModelSystemPrompt(enabledCapabilities, {
        allowAdaptiveGoals,
      }),
      message: JSON.stringify({
        ownerMessage: message,
        temporalContext,
        ...(context?.selectedProject === undefined
          ? {}
          : { selectedProject: context.selectedProject }),
        ...(context?.conversationContext === undefined
          ? {}
          : {
              conversationContext: {
                messages: context.conversationContext.messages.map(
                  ({ role, content }) => ({ role, content }),
                ),
              },
            }),
        ...(context?.memoryContext === undefined ||
        provider.dataBoundary !== 'owner_controlled'
          ? {}
          : {
              memoryContext: context.memoryContext.memories.map(
                ({ kind, subject, content, scope, sensitivity }) => ({
                  kind,
                  subject,
                  content,
                  scope,
                  sensitivity,
                }),
              ),
            }),
      }),
      outputSchema: generationJsonSchema,
    });
    const normalizedCandidate = restoreFirstStepRequirement(
      generation.candidate,
    );
    const enabledProposal = generationSchema.safeParse(normalizedCandidate);
    const validatedProposal = enabledProposal.success
      ? ModelProposalSchema.safeParse(enabledProposal.data)
      : enabledProposal;

    if (!validatedProposal.success) {
      return {
        decisionId: createId(),
        proposal: null,
        decision: {
          kind: 'rejected',
          code: 'invalid_model_output',
          message: 'The model output does not satisfy ModelProposal schema v1.',
        },
        model: {
          provider: generation.provider,
          model: generation.model,
          durationMs: generation.durationMs,
          ...(generation.usage === undefined
            ? {}
            : { usage: generation.usage }),
        },
      };
    }

    return {
      decisionId: createId(),
      proposal: validatedProposal.data,
      decision: decide(
        validatedProposal.data,
        enabledCapabilities,
        context?.selectedProject,
        temporalContext.ownerTimeZone,
        message,
      ),
      model: {
        provider: generation.provider,
        model: generation.model,
        durationMs: generation.durationMs,
        ...(generation.usage === undefined ? {} : { usage: generation.usage }),
      },
    };
  };
}
