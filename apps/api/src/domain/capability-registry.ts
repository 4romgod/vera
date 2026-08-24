import { z } from 'zod';

export const DevelopmentPlanningProposalArgumentsSchema = z
  .object({
    objective: z.string().trim().min(1).max(10_000),
    ticket: z
      .object({
        reference: z.string().trim().min(1).max(200),
        details: z.string().trim().min(1).max(20_000),
      })
      .strict(),
    project: z
      .object({
        name: z.string().trim().min(1).max(200),
      })
      .strict(),
  })
  .strict();

type CapabilityDefinition = {
  name: string;
  version: number;
  proposalArgumentsSchema: z.ZodType<Record<string, unknown>>;
  effect: 'external';
};

const capabilities = [
  {
    name: 'development_planning',
    version: 1,
    proposalArgumentsSchema: DevelopmentPlanningProposalArgumentsSchema,
    effect: 'external',
  },
] satisfies CapabilityDefinition[];

export function findCapability(
  name: string,
  version: number,
): CapabilityDefinition | undefined {
  return capabilities.find(
    (candidate) => candidate.name === name && candidate.version === version,
  );
}

export const ModelVisibleCapabilities = capabilities.map((capability) => ({
  name: capability.name,
  version: capability.version,
  description:
    'Prepare a software implementation plan from a ticket and project identity.',
  proposalArgumentsSchema: z.toJSONSchema(capability.proposalArgumentsSchema, {
    target: 'draft-7',
  }),
}));
