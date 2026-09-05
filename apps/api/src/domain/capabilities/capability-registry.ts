import { z } from 'zod';
import { CapabilityDestinationSchema } from './capability-destination.ts';
import { PersonalTaskActionArgumentsSchema } from '../personal-tasks/personal-task.ts';
import { ReminderActionArgumentsSchema } from '../reminders/reminder.ts';
import { MemoryActionArgumentsSchema } from '../memories/memory.ts';
import { AttachmentAnalysisArgumentsSchema } from '../attachments/attachment-analysis.ts';
import {
  MachineInspectionArgumentsSchema,
  MachineServiceActionArgumentsSchema,
} from '../machines/machine.ts';
import { MissionProposalArgumentsSchema } from '../missions/mission-proposal.ts';
import { KnowledgeActionArgumentsSchema } from '../knowledge/knowledge.ts';
import { AttentionActionArgumentsSchema } from '../attention/attention.ts';
import { RoutineManagementArgumentsSchema } from '../routines/routine.ts';
import {
  SoftwareDeliveryManagementArgumentsSchema,
  SoftwareDeliveryRepairArgumentsSchema,
} from '../software-delivery/software-delivery-arguments.ts';
import { WorkItemActionArgumentsSchema } from '../work-items/work-item.ts';
export { AttachmentAnalysisArgumentsSchema } from '../attachments/attachment-analysis.ts';

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
    approval: z.enum(['always', 'never']),
    projectContext: z.enum(['required', 'none']),
    networkAccess: z.enum([
      'none',
      'provider_api',
      'public_web_via_provider',
      'owner_machine',
    ]),
    dataClasses: z.array(
      z.enum([
        'owner_request',
        'project_context',
        'artifact_content',
        'personal_task_data',
        'personal_reminder_data',
        'long_term_memory',
        'public_web',
        'attachment_content',
        'machine_operational_data',
        'mission_data',
        'personal_knowledge',
        'owner_attention',
        'routine_data',
        'software_delivery_metadata',
        'work_item_data',
      ]),
    ),
    sideEffects: z.array(
      z.enum([
        'third_party_disclosure',
        'isolated_workspace_write',
        'public_network_read',
        'personal_data_write',
        'scheduled_notification',
        'machine_service_control',
        'mission_draft_write',
        'knowledge_write',
        'standing_instruction_write',
        'campaign_repair_draft_write',
        'external_data_write',
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
    name: 'work_item_management',
    version: 1,
    description:
      'Create, list, inspect, comment on, close, or reopen issues in the selected registered project through its enabled provider connection.',
    proposalArgumentsSchema: WorkItemActionArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'work_item_result',
      mediaType: 'application/vnd.vera.work-item-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(create|open|list|show|inspect|comment on|close|reopen)\b.{0,80}\b(issue|work item|github issue)\b/u,
      ],
      description: 'Complete the requested external work-item operation.',
    },
    authority: {
      approval: 'always',
      projectContext: 'required',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'project_context', 'work_item_data'],
      sideEffects: ['third_party_disclosure', 'external_data_write'],
      credentials: 'server_managed',
    },
  },
  {
    name: 'software_delivery_management',
    version: 1,
    description:
      'List or inspect owner-scoped software missions and development campaigns.',
    proposalArgumentsSchema: SoftwareDeliveryManagementArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'software_delivery_management_result',
      mediaType:
        'application/vnd.vera.software-delivery-management-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [],
      description: 'Inspect or manage an existing software delivery.',
    },
    authority: {
      approval: 'never',
      projectContext: 'none',
      networkAccess: 'none',
      dataClasses: ['owner_request', 'software_delivery_metadata'],
      sideEffects: [],
      credentials: 'none',
    },
  },
  {
    name: 'software_delivery_repair',
    version: 1,
    description:
      'Observe an eligible campaign pull request and prepare one frozen exact-head repair approval.',
    proposalArgumentsSchema: SoftwareDeliveryRepairArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'software_delivery_management_result',
      mediaType:
        'application/vnd.vera.software-delivery-management-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [],
      description: 'Prepare an approval for an eligible pull-request repair.',
    },
    authority: {
      approval: 'never',
      projectContext: 'none',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'software_delivery_metadata'],
      sideEffects: ['campaign_repair_draft_write'],
      credentials: 'server_managed',
    },
  },
  {
    name: 'routine_management',
    version: 1,
    description:
      'Create, list, pause, resume, or manually trigger owner-approved recurring standing instructions.',
    proposalArgumentsSchema: RoutineManagementArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'routine_management_result',
      mediaType: 'application/vnd.vera.routine-management-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(every (?:day|morning|evening)|daily|routine|standing instruction|on a schedule)\b/u,
      ],
      description: 'Manage a recurring owner-approved Vera routine.',
    },
    authority: {
      approval: 'never',
      projectContext: 'none',
      networkAccess: 'owner_machine',
      dataClasses: [
        'owner_request',
        'routine_data',
        'machine_operational_data',
      ],
      sideEffects: ['standing_instruction_write'],
      credentials: 'server_managed',
    },
  },
  {
    name: 'attention_management',
    version: 1,
    description:
      'Build a deterministic owner briefing from current approvals, failures, tasks, reminders, missions, and campaigns.',
    proposalArgumentsSchema: AttentionActionArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'attention_result',
      mediaType: 'application/vnd.vera.attention-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(what needs my attention|brief me|my briefing|what should i focus on|what needs me)\b/u,
      ],
      description: 'Show the owner what currently needs attention.',
    },
    authority: {
      approval: 'never',
      projectContext: 'none',
      networkAccess: 'none',
      dataClasses: ['owner_request', 'owner_attention'],
      sideEffects: [],
      credentials: 'none',
    },
  },
  {
    name: 'knowledge_management',
    version: 1,
    description:
      'Add, list, search, or remove owner-governed knowledge with exact source citations.',
    proposalArgumentsSchema: KnowledgeActionArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'knowledge_result',
      mediaType: 'application/vnd.vera.knowledge-result+json',
    },
    acceptedInputArtifacts: ['attachment_analysis'],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(add|save|store|search|find|look up|remove|delete)\b.{0,80}\b(knowledge|knowledge library|library source|my documents|my files)\b/u,
      ],
      description:
        'Manage or search the owner-governed personal knowledge library.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'provider_api',
      dataClasses: [
        'owner_request',
        'artifact_content',
        'attachment_content',
        'personal_knowledge',
      ],
      sideEffects: [
        'third_party_disclosure',
        'personal_data_write',
        'knowledge_write',
      ],
      credentials: 'server_managed',
    },
  },
  {
    name: 'mission_management',
    version: 1,
    description:
      'Draft one bounded, owner-approved software mission that may produce one verified pull request and can never merge it.',
    proposalArgumentsSchema: MissionProposalArgumentsSchema,
    effect: 'owner_state',
    artifact: {
      type: 'mission_management_result',
      mediaType: 'application/vnd.vera.mission-management-result+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [],
      description: 'Create a bounded supervised mission.',
    },
    authority: {
      approval: 'never',
      projectContext: 'none',
      networkAccess: 'none',
      dataClasses: ['owner_request', 'mission_data'],
      sideEffects: ['mission_draft_write'],
      credentials: 'none',
    },
  },
  {
    name: 'attachment_analysis',
    version: 1,
    description:
      'Analyze owner-attached documents and images and return evidence-backed findings.',
    proposalArgumentsSchema: AttachmentAnalysisArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'attachment_analysis',
      mediaType: 'application/vnd.vera.attachment-analysis+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(analy[sz]e|summari[sz]e|review|compare|extract|describe|identify)\b.{0,80}\b(attachment|document|file|pdf|transcript|image|photo|picture|screenshot)\b/u,
      ],
      description: 'Analyze the documents or images attached by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'provider_api',
      dataClasses: ['owner_request', 'attachment_content'],
      sideEffects: ['third_party_disclosure'],
      credentials: 'server_managed',
    },
  },
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
    acceptedInputArtifacts: ['attachment_analysis', 'research_report'],
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
    acceptedInputArtifacts: [
      'attachment_analysis',
      'implementation_plan',
      'research_report',
    ],
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
      dataClasses: ['owner_request', 'artifact_content', 'personal_task_data'],
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
      dataClasses: [
        'owner_request',
        'artifact_content',
        'personal_reminder_data',
      ],
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
      dataClasses: ['owner_request', 'artifact_content', 'long_term_memory'],
      sideEffects: ['personal_data_write'],
      credentials: 'none',
    },
  },
  {
    name: 'machine_inspection',
    version: 1,
    description:
      'Inspect bounded diagnostics and registered service health on an owner-controlled machine.',
    proposalArgumentsSchema: MachineInspectionArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'machine_diagnostic',
      mediaType: 'application/vnd.vera.machine-diagnostic+json',
    },
    acceptedInputArtifacts: [],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(check|inspect|diagnose|status|health)\b.{0,80}\b(machine|server|service|mac mini|macmini)\b/u,
      ],
      description:
        'Inspect the registered machine or service requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'owner_machine',
      dataClasses: ['owner_request', 'machine_operational_data'],
      sideEffects: [],
      credentials: 'server_managed',
    },
  },
  {
    name: 'machine_service_management',
    version: 1,
    description:
      'Start, stop, or restart one named registered service and verify its postcondition.',
    proposalArgumentsSchema: MachineServiceActionArgumentsSchema,
    effect: 'external',
    artifact: {
      type: 'machine_service_action_result',
      mediaType: 'application/vnd.vera.machine-service-action-result+json',
    },
    acceptedInputArtifacts: ['machine_diagnostic'],
    explicitAdaptiveOutcome: {
      patterns: [
        /\b(start|stop|restart)\b.{0,80}\b(service|api|server|redis|mongodb|mongo|ollama)\b/u,
      ],
      description:
        'Apply the exact registered service operation requested by the owner.',
    },
    authority: {
      approval: 'always',
      projectContext: 'none',
      networkAccess: 'owner_machine',
      dataClasses: [
        'owner_request',
        'artifact_content',
        'machine_operational_data',
      ],
      sideEffects: ['machine_service_control'],
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
      dataClasses: ['owner_request', 'artifact_content', 'public_web'],
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
