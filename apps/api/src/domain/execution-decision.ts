import { z } from 'zod';

import { DevelopmentPlanningProposalArgumentsSchema } from './capability-registry.ts';
import { ModelProposalSchema } from './model-proposal.ts';

const ResponseDecisionSchema = z
  .object({
    kind: z.literal('respond'),
    message: z.string(),
  })
  .strict();

const ApprovalRequiredDecisionSchema = z
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

const RejectedProposalDecisionSchema = z
  .object({
    kind: z.literal('rejected'),
    code: z.enum([
      'invalid_model_output',
      'unknown_capability',
      'invalid_capability_arguments',
    ]),
    message: z.string(),
  })
  .strict();

export const ExecutionDecisionSchema = z.discriminatedUnion('kind', [
  ResponseDecisionSchema,
  ApprovalRequiredDecisionSchema,
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
