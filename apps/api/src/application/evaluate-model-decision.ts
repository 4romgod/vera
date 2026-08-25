import { randomUUID } from 'node:crypto';

import { findCapability } from '../domain/capability-registry.ts';
import type { ConversationContextBundle } from '../domain/conversation-context.ts';
import type {
  DecisionResult,
  ExecutionDecision,
} from '../domain/execution-decision.ts';
import {
  ModelProposalJsonSchema,
  ModelProposalSchema,
  type ModelProposal,
} from '../domain/model-proposal.ts';
import { buildModelSystemPrompt } from '../model/model-system-prompt.ts';
import type { ModelProvider } from '../model/model-provider.ts';

export type EvaluateModelDecision = (
  message: string,
  context?: {
    selectedProject?: { id: string; displayName: string };
    conversationContext?: ConversationContextBundle;
  },
) => Promise<DecisionResult>;

function decide(proposal: ModelProposal): ExecutionDecision {
  if (proposal.kind === 'respond') {
    return { kind: 'respond', message: proposal.message };
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

  return {
    kind: 'approval_required',
    reason: 'specialist_capability_invocation',
    capability: proposal.capability,
    proposedArguments: proposal.arguments,
  };
}

export function createEvaluateModelDecision(
  provider: ModelProvider,
  createId: () => string = () => `decision_${randomUUID()}`,
): EvaluateModelDecision {
  return async (message, context) => {
    const generation = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: buildModelSystemPrompt(),
      message:
        context === undefined
          ? message
          : JSON.stringify({
              ownerMessage: message,
              ...(context.selectedProject === undefined
                ? {}
                : { selectedProject: context.selectedProject }),
              ...(context.conversationContext === undefined
                ? {}
                : {
                    conversationContext: {
                      messages: context.conversationContext.messages.map(
                        ({ role, content }) => ({ role, content }),
                      ),
                    },
                  }),
            }),
      outputSchema: ModelProposalJsonSchema,
    });
    const validatedProposal = ModelProposalSchema.safeParse(
      generation.candidate,
    );

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
      decision: decide(validatedProposal.data),
      model: {
        provider: generation.provider,
        model: generation.model,
        durationMs: generation.durationMs,
        ...(generation.usage === undefined ? {} : { usage: generation.usage }),
      },
    };
  };
}
