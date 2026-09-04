import { randomUUID } from 'node:crypto';

import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  AttachmentAnalysisArgumentsSchema,
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
import type { AttachmentReference } from '../../domain/attachments/attachment.ts';
import {
  MachineInspectionArgumentsSchema,
  MachineServiceActionArgumentsSchema,
  publicMachineCatalog,
  type MachineCatalog,
} from '../../domain/machines/machine.ts';
import { MissionProposalArgumentsSchema } from '../../domain/missions/mission.ts';
import { KnowledgeActionArgumentsSchema } from '../../domain/knowledge/knowledge.ts';
import { AttentionActionArgumentsSchema } from '../../domain/attention/attention.ts';
import { RoutineManagementArgumentsSchema } from '../../domain/routines/routine.ts';
import {
  SoftwareDeliveryManagementArgumentsSchema,
  SoftwareDeliveryRepairArgumentsSchema,
  type SoftwareDeliveryContext,
} from '../../domain/software-delivery/software-delivery-management.ts';
import { validateSoftwareDeliveryReference } from './resolve-software-delivery-reference.ts';

export type EvaluateModelDecision = (
  message: string,
  context?: {
    selectedProject?: { id: string; displayName: string };
    conversationContext?: ConversationContextBundle;
    memoryContext?: import('../../domain/memories/memory-context.ts').MemoryContextBundle;
    temporalContext?: { currentTime?: string; ownerTimeZone?: string };
    attachments?: AttachmentReference[];
    softwareDeliveryContext?: SoftwareDeliveryContext;
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

function normalizeAttachmentActionProposal(
  proposal: ModelProposal,
  ownerMessage: string,
  enabledCapabilities: readonly CapabilityReference[],
  attachments: readonly AttachmentReference[],
  allowAdaptiveGoals: boolean,
): { proposal: ModelProposal; exceedsGoalLimit: boolean } {
  if (attachments.length === 0 || !allowAdaptiveGoals) {
    return { proposal, exceedsGoalLimit: false };
  }
  const attachmentAnalysisEnabled = enabledCapabilities.some(
    ({ name, version }) => name === 'attachment_analysis' && version === 1,
  );
  if (!attachmentAnalysisEnabled) {
    return { proposal, exceedsGoalLimit: false };
  }

  const explicitRequirements = inferExplicitAdaptiveRequirements(
    ownerMessage,
    enabledCapabilities,
  );
  const proposalRequirements: AdaptiveRequirement[] =
    proposal.kind === 'invoke_capability'
      ? proposal.capability.name === 'attachment_analysis'
        ? []
        : [
            {
              id: `requirement_proposed_${proposal.capability.name}`,
              description: proposal.decisionSummary,
              capability: proposal.capability.name,
              version: proposal.capability.version,
              condition: { kind: 'always' },
            },
          ]
      : proposal.kind === 'execute_goal'
        ? proposal.goal.steps
            .filter(({ capability }) => capability !== 'attachment_analysis')
            .map((step) => ({
              id: `requirement_proposed_${step.capability}`,
              description: step.purpose,
              capability: step.capability,
              version: step.version,
              condition: { kind: 'always' as const },
            }))
        : proposal.kind === 'pursue_goal'
          ? proposal.goal.requirements.filter(
              ({ capability }) => capability !== 'attachment_analysis',
            )
          : [];
  const downstream = [...explicitRequirements, ...proposalRequirements].filter(
    ({ capability }) => capability !== 'attachment_analysis',
  );
  const uniqueDownstream = downstream.filter(
    (requirement, index) =>
      downstream.findIndex(
        (candidate) =>
          candidate.capability === requirement.capability &&
          candidate.version === requirement.version,
      ) === index,
  );
  if (uniqueDownstream.length === 0) {
    return { proposal, exceedsGoalLimit: false };
  }

  const requirements: AdaptiveRequirement[] = [
    {
      id: 'requirement_attachment_analysis',
      description:
        'Analyze the supplied attachments as evidence for the requested outcome.',
      capability: 'attachment_analysis',
      version: 1,
      condition: { kind: 'always' },
    },
    ...uniqueDownstream,
  ];
  if (requirements.length > 3) {
    return { proposal, exceedsGoalLimit: true };
  }

  const proposedFirstStep =
    proposal.kind === 'invoke_capability' &&
    proposal.capability.name === 'attachment_analysis'
      ? {
          id: 'step_1',
          purpose: proposal.decisionSummary,
          inputStepIds: [],
          capability: 'attachment_analysis' as const,
          version: 1 as const,
          arguments: proposal.arguments,
        }
      : proposal.kind === 'execute_goal' &&
          proposal.goal.steps[0]?.capability === 'attachment_analysis'
        ? proposal.goal.steps[0]
        : proposal.kind === 'pursue_goal' &&
            proposal.goal.firstStep.capability === 'attachment_analysis'
          ? proposal.goal.firstStep
          : {
              id: 'step_1',
              purpose:
                'Analyze the supplied attachments as evidence for the requested outcome.',
              inputStepIds: [],
              capability: 'attachment_analysis' as const,
              version: 1 as const,
              arguments: { objective: ownerMessage },
            };

  return {
    proposal: ModelProposalSchema.parse({
      schemaVersion: 1,
      kind: 'pursue_goal',
      decisionSummary:
        'The requested action depends on evidence that must first be extracted from the supplied attachments.',
      goal: {
        schemaVersion: 1,
        objective: ownerMessage,
        summary:
          'Understand the supplied evidence, then propose each requested action with its own exact approval.',
        completionCriteria:
          'Analyze the supplied attachments, complete every requested downstream outcome, and report the evidence and effects.',
        requirements,
        firstStep: proposedFirstStep,
      },
    }),
    exceedsGoalLimit: false,
  };
}

function decide(
  proposal: ModelProposal,
  enabledCapabilities: readonly CapabilityReference[],
  selectedProject?: { id: string; displayName: string },
  ownerTimeZone = 'UTC',
  ownerMessage = '',
  attachments: readonly AttachmentReference[] = [],
  machines?: MachineCatalog,
  softwareDeliveryContext?: SoftwareDeliveryContext,
  conversationContext?: ConversationContextBundle,
): ExecutionDecision {
  const machineArgumentsAreRegistered = (
    capability: string,
    arguments_: Record<string, unknown>,
  ) => {
    if (
      capability !== 'machine_inspection' &&
      capability !== 'machine_service_management'
    ) {
      return true;
    }
    const machine = machines?.machines.find(
      ({ id }) => id === arguments_.machineId,
    );
    if (machine === undefined) return false;
    if (capability === 'machine_inspection') {
      return (
        !Array.isArray(arguments_.serviceIds) ||
        arguments_.serviceIds.every((id) =>
          machine.services.some((service) => service.id === id),
        )
      );
    }
    const service = machine.services.find(
      ({ id }) => id === arguments_.serviceId,
    );
    const action = arguments_.action;
    return (
      service !== undefined &&
      (action === 'start' || action === 'stop' || action === 'restart') &&
      service.actions[action] !== undefined
    );
  };
  if (attachments.length > 0) {
    const firstCapability =
      proposal.kind === 'invoke_capability'
        ? proposal.capability.name
        : proposal.kind === 'execute_goal'
          ? proposal.goal.steps[0]?.capability
          : proposal.kind === 'pursue_goal'
            ? proposal.goal.firstStep.capability
            : undefined;
    if (firstCapability !== 'attachment_analysis') {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The current attachments require attachment_analysis before Vera can make claims about their content.',
      };
    }
  }

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
    const invalidMachineStep = plan.data.steps.find(
      (step) => !machineArgumentsAreRegistered(step.capability, step.arguments),
    );
    if (invalidMachineStep !== undefined) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message: `Goal step ${invalidMachineStep.id} selected an unregistered machine operation.`,
      };
    }
    if (
      plan.data.steps.some(
        (step) => step.capability === 'attachment_analysis',
      ) &&
      attachments.length === 0
    ) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message: 'Attachment analysis requires a current attachment.',
      };
    }
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
    if (step.capability === 'attachment_analysis' && attachments.length === 0) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message: 'Attachment analysis requires a current attachment.',
      };
    }
    if (!machineArgumentsAreRegistered(step.capability, step.arguments)) {
      return {
        kind: 'rejected',
        code: 'invalid_goal_plan',
        message:
          'The adaptive goal selected an unregistered machine operation.',
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
  if (proposal.capability.name === 'attachment_analysis') {
    if (attachments.length === 0) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message: 'Attachment analysis requires a current attachment.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: AttachmentAnalysisArgumentsSchema.parse(
        proposal.arguments,
      ),
    };
  }
  if (proposal.capability.name === 'machine_inspection') {
    const arguments_ = MachineInspectionArgumentsSchema.parse(
      proposal.arguments,
    );
    if (!machineArgumentsAreRegistered(proposal.capability.name, arguments_)) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed inspection targets an unregistered machine or service.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: arguments_,
    };
  }
  if (proposal.capability.name === 'machine_service_management') {
    const arguments_ = MachineServiceActionArgumentsSchema.parse(
      proposal.arguments,
    );
    if (!machineArgumentsAreRegistered(proposal.capability.name, arguments_)) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed service action is not registered for that machine.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: arguments_,
    };
  }
  if (proposal.capability.name === 'mission_management') {
    const arguments_ = MissionProposalArgumentsSchema.parse(proposal.arguments);
    if (arguments_.project.name !== selectedProject?.displayName) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed mission does not preserve the selected project identity.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: arguments_,
    };
  }
  if (
    proposal.capability.name === 'software_delivery_management' ||
    proposal.capability.name === 'software_delivery_repair'
  ) {
    const arguments_ =
      proposal.capability.name === 'software_delivery_management'
        ? SoftwareDeliveryManagementArgumentsSchema.parse(proposal.arguments)
        : SoftwareDeliveryRepairArgumentsSchema.parse(proposal.arguments);
    const resolution = validateSoftwareDeliveryReference({
      arguments: arguments_,
      ownerMessage,
      ...(conversationContext === undefined ? {} : { conversationContext }),
      ...(softwareDeliveryContext === undefined
        ? {}
        : { context: softwareDeliveryContext }),
    });
    if (!resolution.accepted) {
      return { kind: 'respond', message: resolution.message };
    }
    if (proposal.capability.name === 'software_delivery_management') {
      return {
        kind: 'approval_required',
        reason: 'specialist_capability_invocation',
        capability: { name: 'software_delivery_management', version: 1 },
        proposedArguments:
          SoftwareDeliveryManagementArgumentsSchema.parse(arguments_),
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'software_delivery_repair', version: 1 },
      proposedArguments:
        SoftwareDeliveryRepairArgumentsSchema.parse(arguments_),
    };
  }
  if (proposal.capability.name === 'knowledge_management') {
    const arguments_ = KnowledgeActionArgumentsSchema.parse(proposal.arguments);
    if (
      'scope' in arguments_ &&
      arguments_.scope?.kind === 'project' &&
      arguments_.scope.projectId !== selectedProject?.id
    ) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed knowledge action does not preserve the selected project identity.',
      };
    }
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: arguments_,
    };
  }
  if (proposal.capability.name === 'attention_management') {
    return {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: proposal.capability,
      proposedArguments: AttentionActionArgumentsSchema.parse(
        proposal.arguments,
      ),
    };
  }
  if (proposal.capability.name === 'routine_management') {
    const arguments_ = RoutineManagementArgumentsSchema.parse(
      proposal.arguments,
    );
    if (
      arguments_.action === 'create' &&
      !machineArgumentsAreRegistered(
        'machine_inspection',
        arguments_.routine.action,
      )
    ) {
      return {
        kind: 'rejected',
        code: 'invalid_capability_arguments',
        message:
          'The proposed routine targets an unregistered machine or service.',
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
    machines?: MachineCatalog;
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
        ...(context?.attachments === undefined ||
        context.attachments.length === 0
          ? {}
          : {
              attachments: context.attachments.map(
                ({ filename, mediaType, byteLength }) => ({
                  filename,
                  mediaType,
                  byteLength,
                }),
              ),
            }),
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
        ...(options.machines === undefined
          ? {}
          : {
              registeredMachines: publicMachineCatalog(options.machines)
                .machines,
            }),
        ...(context?.softwareDeliveryContext === undefined
          ? {}
          : {
              softwareDeliveryContext:
                context.softwareDeliveryContext.resources.map((resource) => ({
                  kind: resource.kind,
                  id: resource.id,
                  status: resource.status,
                  objective: resource.objective.slice(0, 500),
                  project: { displayName: resource.project.displayName },
                  ...(resource.kind === 'mission'
                    ? { campaignId: resource.campaignId }
                    : {
                        repairAvailable: resource.repairAvailable,
                        ...(resource.pullRequest === undefined
                          ? {}
                          : {
                              pullRequest: {
                                number: resource.pullRequest.number,
                                checks: resource.pullRequest.checks,
                                reviewDecision:
                                  resource.pullRequest.reviewDecision,
                              },
                            }),
                      }),
                })),
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

    const normalizedAttachmentAction = normalizeAttachmentActionProposal(
      validatedProposal.data,
      message,
      enabledCapabilities,
      context?.attachments ?? [],
      allowAdaptiveGoals,
    );
    const proposal = normalizedAttachmentAction.proposal;
    return {
      decisionId: createId(),
      proposal,
      decision: normalizedAttachmentAction.exceedsGoalLimit
        ? {
            kind: 'rejected',
            code: 'invalid_goal_plan',
            message:
              'The attachment request contains more downstream outcomes than Vera can preserve in one bounded goal.',
          }
        : decide(
            proposal,
            enabledCapabilities,
            context?.selectedProject,
            temporalContext.ownerTimeZone,
            message,
            context?.attachments ?? [],
            options.machines,
            context?.softwareDeliveryContext,
            context?.conversationContext,
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
