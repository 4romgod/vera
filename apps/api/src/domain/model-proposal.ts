import { z } from 'zod';

import { DevelopmentPlanningProposalArgumentsSchema } from './capability-registry.ts';

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

const InvokeCapabilityProposalSchema = z
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

export const ModelProposalSchema = z.discriminatedUnion('kind', [
  RespondProposalSchema,
  InvokeCapabilityProposalSchema,
]);

export type ModelProposal = z.infer<typeof ModelProposalSchema>;

export const ModelProposalJsonSchema = z.toJSONSchema(ModelProposalSchema, {
  target: 'draft-7',
});
