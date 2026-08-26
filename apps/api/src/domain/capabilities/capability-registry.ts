import { z } from 'zod';
import { CapabilityDestinationSchema } from './capability-destination.ts';
import { PersonalTaskActionArgumentsSchema } from '../personal-tasks/personal-task.ts';
import { ReminderActionArgumentsSchema } from '../reminders/reminder.ts';
import { MemoryActionArgumentsSchema } from '../memories/memory.ts';

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
      z.enum([
        'owner_request',
        'project_context',
        'artifact_content',
        'personal_task_data',
        'personal_reminder_data',
        'long_term_memory',
        'public_web',
      ]),
    ),
    sideEffects: z.array(
      z.enum([
        'third_party_disclosure',
        'isolated_workspace_write',
        'public_network_read',
        'personal_data_write',
        'scheduled_notification',
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
  effect: 'external' | 'owner_state';
  artifact: { type: string; mediaType: string };
  acceptedInputArtifacts: string[];
  authority: z.infer<typeof CapabilityAuthoritySchema>;
  explicitAdaptiveOutcome: {
    patterns: readonly RegExp[];
    description: string;
  };
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
    acceptedInputArtifacts: ['research_report'],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(plan|design)\b.{0,60}\b(implementation|feature|fix|change)\b/u,
      ],
      description: 'Produce the software plan requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'required',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'project_context', 'artifact_content'],
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
    acceptedInputArtifacts: ['implementation_plan', 'research_report'],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(implement|fix|modify|edit|write|change)\b.{0,80}\b(code|file|project|application|app|api)\b/u,
      ],
      description: 'Produce the software change requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'required',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'project_context', 'artifact_content'],
      sideEffects: ['third_party_disclosure', 'isolated_workspace_write'],
      credentials: 'server_managed',
    },
  },
  {
    name: 'personal_task_management',
    version: 1,
    description:
      'Create, list, complete, or reopen durable owner-scoped personal tasks.',
    proposalArgumentsSchema: PersonalTaskActionArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'personal_task_result',
      mediaType: 'application/vnd.vera.personal-task-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(create|add|list|complete|reopen)\b.{0,60}\b(task|todo|to-do)\b/u,
      ],
      description: 'Complete the personal-task action requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'none',
      dataClasses: ['owner_request', 'personal_task_data'],
      sideEffects: ['personal_data_write'],
      credentials: 'none',
    },
  },
  {
    name: 'personal_reminder_management',
    version: 1,
    description:
      'Create, list, reschedule, cancel, or acknowledge durable owner reminders.',
    proposalArgumentsSchema: ReminderActionArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'personal_reminder_result',
      mediaType: 'application/vnd.vera.personal-reminder-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(remind me|set (?:me )?(?:a )?reminder|create (?:a )?reminder|schedule (?:a )?reminder)\b/u,
      ],
      description: 'Complete the reminder action requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'none',
      dataClasses: ['owner_request', 'personal_reminder_data'],
      sideEffects: ['personal_data_write', 'scheduled_notification'],
      credentials: 'none',
    },
  },
  {
    name: 'memory_management',
    version: 1,
    description:
      'Remember, inspect, correct, or forget explicit owner-governed long-term memory.',
    proposalArgumentsSchema: MemoryActionArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'memory_result',
      mediaType: 'application/vnd.vera.memory-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(remember|memorize|what do you remember|correct (?:that )?memory|forget)\b/u,
      ],
      description:
        'Complete the governed-memory action requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'none',
      dataClasses: ['owner_request', 'long_term_memory'],
      sideEffects: ['personal_data_write'],
      credentials: 'none',
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
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(research|look up|search (?:the )?web|investigate|verify whether|find out)\b/u,
      ],
      description: 'Complete the public-web research requested by the owner.',
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

export function findExplicitAdaptiveOutcomes(
  ownerMessage: string,
  enabled: readonly CapabilityReference[],
): {
  capability: CapabilityReference;
  description: string;
}[] {
  const message = ownerMessage.toLowerCase();
  return CapabilityDefinitions.filter(
    (definition) =>
      enabled.some(
        (reference) =>
          reference.name === definition.name &&
          reference.version === definition.version,
      ) &&
      definition.explicitAdaptiveOutcome.patterns.some((pattern) =>
        pattern.test(message),
      ),
  ).map((definition) => ({
    capability: { name: definition.name, version: definition.version },
    description: definition.explicitAdaptiveOutcome.description,
  }));
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
          effect: z.enum(['external', 'owner_state']),
          artifact: z
            .object({
              type: z.string().min(1),
              mediaType: z.string().min(1),
            })
            .strict(),
          acceptedInputArtifacts: z.array(z.string().min(1)),
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
