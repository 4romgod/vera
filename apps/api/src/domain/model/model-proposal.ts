import { z } from 'zod';

import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
} from '../capabilities/capability-registry.ts';

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

export const ModelProposalSchema = z.union([
  RespondProposalSchema,
  DevelopmentPlanningProposalSchema,
  SoftwareChangeProposalSchema,
  WebResearchProposalSchema,
]);

export function createModelProposalSchema(options: {
  webResearchEnabled: boolean;
}) {
  return options.webResearchEnabled
    ? ModelProposalSchema
    : z.union([
        RespondProposalSchema,
        DevelopmentPlanningProposalSchema,
        SoftwareChangeProposalSchema,
      ]);
}

export type ModelProposal = z.infer<typeof ModelProposalSchema>;

export const ModelProposalJsonSchema = z.toJSONSchema(ModelProposalSchema, {
  target: 'draft-7',
});
