import {
  CapabilityDefinitions,
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  AttachmentAnalysisArgumentsSchema,
  type CapabilityDefinition,
  type CapabilityAuthority,
  type CapabilityReference,
} from '../../../domain/capabilities/capability-registry.ts';
import {
  PersonalTaskActionArgumentsSchema,
  PersonalTaskResultSchema,
  type PersonalTaskActionArguments,
  type PersonalTaskResult,
} from '../../../domain/personal-tasks/personal-task.ts';
import { DevelopmentPlanSchema } from '../../../domain/plans/development-plan.ts';
import { SoftwareChangeSchema } from '../../../domain/changes/software-change.ts';
import { ResearchReportSchema } from '../../../domain/research/research-report.ts';
import {
  sameCapabilityDestination,
  type CapabilityDestination,
} from '../../../domain/capabilities/capability-destination.ts';
import type {
  CapabilityRuntime,
  CapabilityRuntimeRegistration,
  CapabilityRuntimeRegistry,
} from '../../../ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../../ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../../ports/capabilities/software-change-capability.ts';
import type { WebResearchCapabilityRegistry } from '../../../ports/capabilities/web-research-capability.ts';
import type { IntegrationActionExecutor } from '../../../ports/integrations/integration-action-executor.ts';
import {
  ReminderActionArgumentsSchema,
  ReminderResultSchema,
  type ReminderActionArguments,
  type ReminderResult,
} from '../../../domain/reminders/reminder.ts';
import {
  MemoryActionArgumentsSchema,
  MemoryResultSchema,
  type MemoryActionArguments,
  type MemoryResult,
} from '../../../domain/memories/memory.ts';
import {
  assertAttachmentAnalysisCitations,
  AttachmentAnalysisContentSchema,
  AttachmentAnalysisModelContentJsonSchema,
  AttachmentAnalysisModelContentSchema,
  AttachmentAnalysisSchema,
  cleanAttachmentAnalysisProse,
} from '../../../domain/attachments/attachment-analysis.ts';
import type { AttachmentAnalysisSource } from '../../../ports/attachments/attachment-analysis-source.ts';
import type { ModelProvider } from '../../../ports/model/model-provider.ts';
import type {
  DocumentAttachment,
  ImageAttachment,
} from '../../../domain/attachments/attachment.ts';

function definition(name: string): CapabilityDefinition {
  const value = CapabilityDefinitions.find(
    (candidate) => candidate.name === name && candidate.version === 1,
  );
  if (value === undefined) throw new Error(`Capability ${name}@1 is missing.`);
  return value;
}

function requireProjectInvocation(
  invocation: Parameters<CapabilityRuntime['execute']>[0],
) {
  if (invocation.project === undefined || invocation.context === undefined) {
    throw new Error('The project capability invocation is missing context.');
  }
  return { project: invocation.project, context: invocation.context };
}

function requireAcceptedArtifacts(
  invocation: Parameters<CapabilityRuntime['execute']>[0],
  definition_: CapabilityDefinition,
) {
  const artifacts = invocation.artifacts ?? [];
  const unsupported = artifacts.find(
    (artifact) => !definition_.acceptedInputArtifacts.includes(artifact.type),
  );
  if (unsupported !== undefined) {
    throw new Error(
      `${definition_.name}@${String(definition_.version)} does not accept ${unsupported.type} artifacts.`,
    );
  }
  return artifacts;
}

function withArtifactAuthority(
  authority: CapabilityAuthority,
  hasInputArtifacts: boolean,
): CapabilityAuthority {
  return {
    ...authority,
    dataClasses: authority.dataClasses.filter(
      (dataClass) => dataClass !== 'artifact_content' || hasInputArtifacts,
    ),
  };
}

function projectCapabilityAuthority(options: {
  destination: CapabilityDestination;
  isolatedWorkspaceWrite: boolean;
}): CapabilityAuthority {
  const thirdParty = options.destination.dataBoundary === 'third_party';
  return {
    approval: 'always',
    projectContext: 'required',
    networkAccess: thirdParty ? 'provider_api' : 'none',
    dataClasses: ['owner_request', 'project_context', 'artifact_content'],
    sideEffects: [
      ...(thirdParty ? (['third_party_disclosure'] as const) : []),
      ...(options.isolatedWorkspaceWrite
        ? (['isolated_workspace_write'] as const)
        : []),
    ],
    credentials: thirdParty ? 'server_managed' : 'none',
  };
}

function webResearchAuthority(
  destination: CapabilityDestination,
): CapabilityAuthority {
  const thirdParty = destination.dataBoundary === 'third_party';
  return {
    approval: 'always',
    projectContext: 'none',
    networkAccess: thirdParty ? 'public_web_via_provider' : 'none',
    dataClasses: ['owner_request', 'public_web'],
    sideEffects: thirdParty
      ? ['third_party_disclosure', 'public_network_read']
      : [],
    credentials: thirdParty ? 'server_managed' : 'none',
    maxWebSearchCalls: 4,
  };
}

function attachmentAnalysisRegistration(options: {
  provider: ModelProvider;
  attachments: AttachmentAnalysisSource;
}): CapabilityRuntimeRegistration {
  const assertNotAborted = (signal?: AbortSignal) => {
    if (signal?.aborted === true) {
      throw new DOMException('Attachment analysis was aborted.', 'AbortError');
    }
  };
  const capabilityDefinition = definition('attachment_analysis');
  const destination = {
    schemaVersion: 1 as const,
    adapterId: 'structured_model',
    provider: options.provider.name,
    transport: 'in_process',
    dataBoundary: options.provider.dataBoundary,
  };
  const authority = (): CapabilityAuthority => {
    const thirdParty = destination.dataBoundary === 'third_party';
    return {
      approval: 'always',
      projectContext: 'none',
      networkAccess: thirdParty ? 'provider_api' : 'none',
      dataClasses: ['owner_request', 'attachment_content'],
      sideEffects: thirdParty ? ['third_party_disclosure'] : [],
      credentials: thirdParty ? 'server_managed' : 'none',
    };
  };
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination,
    authority: authority(),
    authorityFor: () => authority(),
    checkReadiness: () =>
      options.provider.checkReadiness().then(() => undefined),
    async execute(invocation, executionOptions) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Attachment analysis must not receive project context or artifacts.',
        );
      }
      const references = invocation.attachments ?? [];
      if (references.length === 0) {
        throw new Error(
          'Attachment analysis requires at least one frozen attachment.',
        );
      }
      assertNotAborted(executionOptions?.signal);
      const arguments_ = AttachmentAnalysisArgumentsSchema.parse(
        invocation.arguments,
      );
      const loadedAttachments = await options.attachments.loadForAnalysis(
        invocation.principalId,
        references,
      );
      const sources: (
        | {
            kind: 'document';
            attachment: DocumentAttachment;
            segment: DocumentAttachment['extraction']['segments'][number];
          }
        | {
            kind: 'image';
            attachment: ImageAttachment;
            vision: {
              mediaType: 'image/jpeg' | 'image/png';
              bytes: Uint8Array;
            };
          }
      )[] = [];
      for (const loaded of loadedAttachments) {
        if ('vision' in loaded) {
          sources.push({
            kind: 'image',
            attachment: loaded.attachment,
            vision: loaded.vision,
          });
          continue;
        }
        for (const segment of loaded.attachment.extraction.segments) {
          sources.push({
            kind: 'document',
            attachment: loaded.attachment,
            segment,
          });
        }
      }
      const numberedSources = sources.map((source, index) => ({
        ...source,
        sourceId: `source_${String(index + 1)}`,
      }));
      const generation = await options.provider.generateStructured({
        purpose: 'attachment_analysis',
        systemPrompt: [
          "You are Vera's attachment-analysis specialist.",
          'Analyze only the supplied approved document segments and images.',
          'Images accompany the message in the exact order of image sources in the source manifest.',
          'Every material finding must be supported by at least one citation.',
          'Each finding must be a complete plain-language observation. Never return fragments, delimiters, or JSON punctuation as finding text.',
          'Answer every part of the objective that the supplied evidence supports, including requested user impact.',
          'Support material findings by citing one or more supplied sourceId values exactly.',
          'Put sourceId values only in the citations array, never in summary, findings, or limitations prose.',
          'State uncertainty or missing evidence in limitations. Never invent facts.',
          'Return only the requested structured output.',
        ].join('\n\n'),
        message: JSON.stringify({
          objective: arguments_.objective,
          sources: numberedSources.map((source) =>
            source.kind === 'document'
              ? {
                  sourceId: source.sourceId,
                  kind: source.kind,
                  filename: source.attachment.filename,
                  mediaType: source.attachment.mediaType,
                  locator: source.segment.locator,
                  text: source.segment.text,
                }
              : {
                  sourceId: source.sourceId,
                  kind: source.kind,
                  filename: source.attachment.filename,
                  mediaType: source.attachment.mediaType,
                  width: source.attachment.vision.width,
                  height: source.attachment.vision.height,
                },
          ),
        }),
        images: numberedSources.flatMap((source) =>
          source.kind === 'image'
            ? [
                {
                  sourceId: source.sourceId,
                  filename: source.attachment.filename,
                  mediaType: source.vision.mediaType,
                  bytes: source.vision.bytes,
                },
              ]
            : [],
        ),
        outputSchema: AttachmentAnalysisModelContentJsonSchema,
      });
      assertNotAborted(executionOptions?.signal);
      const modelContent = AttachmentAnalysisModelContentSchema.parse(
        generation.candidate,
      );
      const citedSources = [
        ...new Set(modelContent.citations.map(({ sourceId }) => sourceId)),
      ].map((sourceId) => {
        const index = Number.parseInt(sourceId.slice('source_'.length), 10) - 1;
        const source = numberedSources.at(index);
        if (source === undefined) {
          throw new Error(
            'Attachment analysis cited evidence outside the approved source set.',
          );
        }
        return source;
      });
      const content = AttachmentAnalysisContentSchema.parse({
        summary: cleanAttachmentAnalysisProse(modelContent.summary),
        findings: modelContent.findings.map(cleanAttachmentAnalysisProse),
        citations: citedSources.map((source) =>
          source.kind === 'document'
            ? {
                kind: source.kind,
                attachmentId: source.attachment.id,
                filename: source.attachment.filename,
                locator: source.segment.locator,
                excerpt: source.segment.text.slice(0, 500).trim(),
              }
            : {
                kind: source.kind,
                attachmentId: source.attachment.id,
                filename: source.attachment.filename,
              },
        ),
        limitations: modelContent.limitations.map(cleanAttachmentAnalysisProse),
      });
      const attachments = loadedAttachments.map(({ attachment }) => attachment);
      assertAttachmentAnalysisCitations(content, attachments);
      return {
        artifact: {
          type: 'attachment_analysis',
          mediaType: 'application/vnd.vera.attachment-analysis+json',
          content: AttachmentAnalysisSchema.parse({
            schemaVersion: 1,
            objective: arguments_.objective,
            attachments: attachments.map((attachment) => ({
              id: attachment.id,
              kind: attachment.kind,
              filename: attachment.filename,
              mediaType: attachment.mediaType,
              sha256: attachment.sha256,
            })),
            ...content,
            analyzedAt: new Date().toISOString(),
          }),
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
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(candidate) {
      return sameCapabilityDestination(destination, candidate)
        ? runtime()
        : null;
    },
  };
}

function planningRegistration(
  registry: DevelopmentPlanningCapabilityRegistry,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('development_planning');
  const wrap = (
    capability: ReturnType<DevelopmentPlanningCapabilityRegistry['selected']>,
  ): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: capability.destination,
    authority: projectCapabilityAuthority({
      destination: capability.destination,
      isolatedWorkspaceWrite: false,
    }),
    authorityFor: ({ hasInputArtifacts }) =>
      withArtifactAuthority(
        projectCapabilityAuthority({
          destination: capability.destination,
          isolatedWorkspaceWrite: false,
        }),
        hasInputArtifacts,
      ),
    checkReadiness: () => capability.checkReadiness(),
    async execute(invocation, options) {
      const { project, context } = requireProjectInvocation(invocation);
      const artifacts = requireAcceptedArtifacts(
        invocation,
        capabilityDefinition,
      );
      const arguments_ = DevelopmentPlanningProposalArgumentsSchema.parse(
        invocation.arguments,
      );
      const result = await capability.execute(
        {
          schemaVersion: 1,
          invocationId: invocation.invocationId,
          arguments: arguments_,
          project,
          context,
          ...(artifacts.length === 0 ? {} : { artifacts }),
          limits: {
            maxDurationMs: invocation.limits.maxDurationMs,
            maxArtifactBytes: invocation.limits.maxArtifactBytes,
          },
        },
        options,
      );
      if (
        result.plan.project.id !== project.id ||
        result.plan.project.name !== project.displayName ||
        result.plan.project.revision !== context.manifest.revision ||
        result.plan.objective !== arguments_.objective ||
        result.plan.ticket.reference !== arguments_.ticket.reference ||
        result.plan.ticket.details !== arguments_.ticket.details
      ) {
        throw new Error(
          'The planning result did not preserve authoritative invocation identity.',
        );
      }
      return {
        artifact: {
          type: 'implementation_plan',
          mediaType: 'application/vnd.vera.implementation-plan+json',
          content: DevelopmentPlanSchema.parse(result.plan),
        },
        model: result.model,
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: () => wrap(registry.selected()),
    resolve(destination) {
      const capability = registry.resolve(destination);
      return capability === null ? null : wrap(capability);
    },
  };
}

function softwareChangeRegistration(
  registry: SoftwareChangeCapabilityRegistry,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('software_change');
  const wrap = (
    capability: ReturnType<SoftwareChangeCapabilityRegistry['selected']>,
  ): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: capability.destination,
    authority: projectCapabilityAuthority({
      destination: capability.destination,
      isolatedWorkspaceWrite: true,
    }),
    authorityFor: ({ hasInputArtifacts }) =>
      withArtifactAuthority(
        projectCapabilityAuthority({
          destination: capability.destination,
          isolatedWorkspaceWrite: true,
        }),
        hasInputArtifacts,
      ),
    checkReadiness: () => capability.checkReadiness(),
    async execute(invocation, options) {
      const { project, context } = requireProjectInvocation(invocation);
      const artifacts = requireAcceptedArtifacts(
        invocation,
        capabilityDefinition,
      );
      const arguments_ = SoftwareChangeProposalArgumentsSchema.parse(
        invocation.arguments,
      );
      const result = await capability.execute(
        {
          schemaVersion: 1,
          invocationId: invocation.invocationId,
          arguments: arguments_,
          project,
          context,
          ...(artifacts.length === 0 ? {} : { artifacts }),
          limits: {
            maxDurationMs: invocation.limits.maxDurationMs,
            maxArtifactBytes: invocation.limits.maxArtifactBytes,
            maxChangedFiles: invocation.limits.maxChangedFiles,
          },
        },
        options,
      );
      if (
        result.change.project.id !== project.id ||
        result.change.project.name !== project.displayName ||
        result.change.project.revision !== context.manifest.revision ||
        result.change.objective !== arguments_.objective ||
        result.change.ticket.reference !== arguments_.ticket.reference ||
        result.change.ticket.details !== arguments_.ticket.details
      ) {
        throw new Error(
          'The software-change result did not preserve authoritative invocation identity.',
        );
      }
      return {
        artifact: {
          type: 'software_change',
          mediaType: 'application/vnd.vera.software-change+json',
          content: SoftwareChangeSchema.parse(result.change),
        },
        model: result.model,
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: () => wrap(registry.selected()),
    resolve(destination) {
      const capability = registry.resolve(destination);
      return capability === null ? null : wrap(capability);
    },
  };
}

function webResearchRegistration(
  registry: WebResearchCapabilityRegistry,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('web_research');
  const wrap = (
    capability: NonNullable<
      ReturnType<WebResearchCapabilityRegistry['selected']>
    >,
  ): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: capability.destination,
    authority: webResearchAuthority(capability.destination),
    authorityFor: () => webResearchAuthority(capability.destination),
    checkReadiness: () => capability.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error('Web research must not receive project context.');
      }
      const arguments_ = WebResearchProposalArgumentsSchema.parse(
        invocation.arguments,
      );
      const result = await capability.execute(
        {
          schemaVersion: 1,
          invocationId: invocation.invocationId,
          arguments: arguments_,
          limits: {
            maxDurationMs: invocation.limits.maxDurationMs,
            maxArtifactBytes: invocation.limits.maxArtifactBytes,
            maxWebSearchCalls: invocation.limits.maxWebSearchCalls,
          },
        },
        options,
      );
      if (result.report.objective !== arguments_.objective) {
        throw new Error(
          'The research report did not preserve the approved objective.',
        );
      }
      return {
        artifact: {
          type: 'research_report',
          mediaType: 'application/vnd.vera.research-report+json',
          content: ResearchReportSchema.parse(result.report),
        },
        model: result.model,
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected() {
      const capability = registry.selected();
      return capability === null ? null : wrap(capability);
    },
    resolve(destination) {
      const capability = registry.resolve(destination);
      return capability === null ? null : wrap(capability);
    },
  };
}

function personalTaskRegistration(
  executor: IntegrationActionExecutor<
    PersonalTaskActionArguments,
    PersonalTaskResult
  >,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('personal_task_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: executor.maximumAuthority,
    authorityFor({ arguments: arguments_ }) {
      return executor.authorityFor(
        PersonalTaskActionArgumentsSchema.parse(arguments_),
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Personal task management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: PersonalTaskActionArgumentsSchema.parse(
            invocation.arguments,
          ),
        },
        options,
      );
      return {
        artifact: {
          type: 'personal_task_result',
          mediaType: 'application/vnd.vera.personal-task-result+json',
          content: PersonalTaskResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

function reminderRegistration(
  executor: IntegrationActionExecutor<ReminderActionArguments, ReminderResult>,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('personal_reminder_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: executor.maximumAuthority,
    authorityFor({ arguments: arguments_ }) {
      return executor.authorityFor(
        ReminderActionArgumentsSchema.parse(arguments_),
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Reminder management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: ReminderActionArgumentsSchema.parse(invocation.arguments),
        },
        options,
      );
      return {
        artifact: {
          type: 'personal_reminder_result',
          mediaType: 'application/vnd.vera.personal-reminder-result+json',
          content: ReminderResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

function memoryRegistration(
  executor: IntegrationActionExecutor<MemoryActionArguments, MemoryResult>,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('memory_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: executor.maximumAuthority,
    authorityFor({ arguments: arguments_ }) {
      return executor.authorityFor(
        MemoryActionArgumentsSchema.parse(arguments_),
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Memory management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: MemoryActionArgumentsSchema.parse(invocation.arguments),
          ...(invocation.source === undefined
            ? {}
            : { source: invocation.source }),
        },
        options,
      );
      return {
        artifact: {
          type: 'memory_result',
          mediaType: 'application/vnd.vera.memory-result+json',
          content: MemoryResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

function sameReference(
  definition_: CapabilityDefinition,
  reference: CapabilityReference,
): boolean {
  return (
    definition_.name === reference.name &&
    definition_.version === reference.version
  );
}

export function createCapabilityRuntimeRegistry(options: {
  provider: ModelProvider;
  attachmentAnalysisProvider?: ModelProvider;
  attachments: AttachmentAnalysisSource;
  developmentPlanning: DevelopmentPlanningCapabilityRegistry;
  softwareChange: SoftwareChangeCapabilityRegistry;
  webResearch: WebResearchCapabilityRegistry;
  personalTasks: IntegrationActionExecutor<
    PersonalTaskActionArguments,
    PersonalTaskResult
  >;
  reminders: IntegrationActionExecutor<ReminderActionArguments, ReminderResult>;
  memories: IntegrationActionExecutor<MemoryActionArguments, MemoryResult>;
}): CapabilityRuntimeRegistry {
  const registrations = [
    attachmentAnalysisRegistration({
      provider: options.attachmentAnalysisProvider ?? options.provider,
      attachments: options.attachments,
    }),
    planningRegistration(options.developmentPlanning),
    softwareChangeRegistration(options.softwareChange),
    webResearchRegistration(options.webResearch),
    personalTaskRegistration(options.personalTasks),
    reminderRegistration(options.reminders),
    memoryRegistration(options.memories),
  ];
  const registrationFor = (reference: CapabilityReference) =>
    registrations.find((candidate) =>
      sameReference(candidate.definition, reference),
    );
  return {
    declarations: () =>
      registrations.map((registration) => {
        const selected = registration.selected();
        return {
          definition: registration.definition,
          authority: selected?.authority ?? registration.definition.authority,
          enabled: selected !== null,
          ...(selected === null ? {} : { destination: selected.destination }),
        };
      }),
    enabledReferences: () =>
      registrations.flatMap((registration) =>
        registration.selected() === null
          ? []
          : [
              {
                name: registration.definition.name,
                version: registration.definition.version,
              },
            ],
      ),
    selected(reference) {
      return registrationFor(reference)?.selected() ?? null;
    },
    resolve(reference, destination: CapabilityDestination) {
      return registrationFor(reference)?.resolve(destination) ?? null;
    },
  };
}
