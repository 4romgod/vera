import { z } from 'zod';
import { CapabilityDestinationSchema } from './capability-destination.ts';

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

export const SoftwareChangeProposalArgumentsSchema = z
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

export const WebResearchProposalArgumentsSchema = z
  .object({
    objective: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const CapabilityReferenceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    version: z.number().int().positive(),
  })
  .strict();

export const CapabilityAuthoritySchema = z
  .object({
    approval: z.literal('always'),
    projectContext: z.enum(['required', 'none']),
    networkAccess: z.enum(['none', 'provider_api', 'public_web_via_provider']),
    dataClasses: z.array(
      z.enum(['owner_request', 'project_context', 'public_web']),
    ),
    sideEffects: z.array(
      z.enum([
        'third_party_disclosure',
        'isolated_workspace_write',
        'public_network_read',
      ]),
    ),
    credentials: z.enum(['none', 'server_managed']),
    maxWebSearchCalls: z.number().int().positive().max(20).optional(),
  })
  .strict();

export type CapabilityDefinition = {
  name: string;
  version: number;
  description: string;
  proposalArgumentsSchema: z.ZodType<Record<string, unknown>>;
  effect: 'external';
  artifact: { type: string; mediaType: string };
  authority: z.infer<typeof CapabilityAuthoritySchema>;
};

export const CapabilityDefinitions = [
  {
    name: 'development_planning',
    version: 1,
    description:
      'Prepare a software implementation plan from a ticket and project identity.',
    proposalArgumentsSchema: DevelopmentPlanningProposalArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'implementation_plan',
      mediaType: 'application/vnd.vera.implementation-plan+json',
    },
    authority: {
      approval: 'always',
      projectContext: 'required',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'project_context'],
      sideEffects: ['third_party_disclosure'],
      credentials: 'server_managed',
    },
  },
  {
    name: 'software_change',
    version: 1,
    description:
      'Produce a reviewable software patch artifact in an isolated workspace without mutating the registered project.',
    proposalArgumentsSchema: SoftwareChangeProposalArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'software_change',
      mediaType: 'application/vnd.vera.software-change+json',
    },
    authority: {
      approval: 'always',
      projectContext: 'required',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'project_context'],
      sideEffects: ['third_party_disclosure', 'isolated_workspace_write'],
      credentials: 'server_managed',
    },
  },
  {
    name: 'web_research',
    version: 1,
    description:
      'Research a project-independent question on the public web and return a source-backed report.',
    proposalArgumentsSchema: WebResearchProposalArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'research_report',
      mediaType: 'application/vnd.vera.research-report+json',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'public_web_via_provider',
      dataClasses: ['owner_request', 'public_web'],
      sideEffects: ['third_party_disclosure', 'public_network_read'],
      credentials: 'server_managed',
      maxWebSearchCalls: 4,
    },
  },
] satisfies CapabilityDefinition[];

export function findCapability(
  name: string,
  version: number,
): CapabilityDefinition | undefined {
  return CapabilityDefinitions.find(
    (candidate) => candidate.name === name && candidate.version === version,
  );
}

export type CapabilityReference = z.infer<typeof CapabilityReferenceSchema>;
export type CapabilityAuthority = z.infer<typeof CapabilityAuthoritySchema>;

export const CapabilityCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    capabilities: z.array(
      z
        .object({
          name: CapabilityReferenceSchema.shape.name,
          version: CapabilityReferenceSchema.shape.version,
          description: z.string().min(1),
          effect: z.literal('external'),
          artifact: z
            .object({
              type: z.string().min(1),
              mediaType: z.string().min(1),
            })
            .strict(),
          authority: CapabilityAuthoritySchema,
          enabled: z.boolean(),
          destination: CapabilityDestinationSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type CapabilityCatalog = z.infer<typeof CapabilityCatalogSchema>;

export function modelVisibleCapabilities(
  enabled: readonly CapabilityReference[],
) {
  return CapabilityDefinitions.filter((capability) =>
    enabled.some(
      (reference) =>
        reference.name === capability.name &&
        reference.version === capability.version,
    ),
  ).map((capability) => ({
    name: capability.name,
    version: capability.version,
    description: capability.description,
    proposalArgumentsSchema: z.toJSONSchema(
      capability.proposalArgumentsSchema,
      { target: 'draft-7' },
    ),
  }));
}
