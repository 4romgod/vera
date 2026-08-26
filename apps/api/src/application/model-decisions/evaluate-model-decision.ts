import { randomUUID } from 'node:crypto';

import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  findCapability,
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
import { GoalPlanSchema } from '../../domain/goals/goal-plan.ts';
import { PersonalTaskActionArgumentsSchema } from '../../domain/personal-tasks/personal-task.ts';
import { ReminderActionArgumentsSchema } from '../../domain/reminders/reminder.ts';

export type EvaluateModelDecision = (
  message: string,
  context?: {
    selectedProject?: { id: string; displayName: string };
    conversationContext?: ConversationContextBundle;
    temporalContext?: { currentTime?: string; ownerTimeZone?: string };
  },
) => Promise<DecisionResult>;

function decide(
  proposal: ModelProposal,
  enabledCapabilities: readonly CapabilityReference[],
  selectedProject?: { id: string; displayName: string },
  ownerTimeZone = 'UTC',
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
  const generationSchema = createModelProposalSchema({ enabledCapabilities });
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
      systemPrompt: buildModelSystemPrompt(enabledCapabilities),
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
      }),
      outputSchema: generationJsonSchema,
    });
    const enabledProposal = generationSchema.safeParse(generation.candidate);
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
