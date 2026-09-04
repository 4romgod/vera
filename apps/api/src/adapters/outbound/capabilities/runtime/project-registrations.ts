import {
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  AttachmentAnalysisArgumentsSchema,
  type CapabilityAuthority,
} from '../../../../domain/capabilities/capability-registry.ts';
import { DevelopmentPlanSchema } from '../../../../domain/plans/development-plan.ts';
import { SoftwareChangeSchema } from '../../../../domain/changes/software-change.ts';
import { ResearchReportSchema } from '../../../../domain/research/research-report.ts';
import { sameCapabilityDestination } from '../../../../domain/capabilities/capability-destination.ts';
import type {
  CapabilityRuntime,
  CapabilityRuntimeRegistration,
} from '../../../../ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../../../ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../../../ports/capabilities/software-change-capability.ts';
import type { WebResearchCapabilityRegistry } from '../../../../ports/capabilities/web-research-capability.ts';
import {
  assertAttachmentAnalysisCitations,
  AttachmentAnalysisContentSchema,
  AttachmentAnalysisModelContentJsonSchema,
  AttachmentAnalysisModelContentSchema,
  AttachmentAnalysisSchema,
  cleanAttachmentAnalysisProse,
} from '../../../../domain/attachments/attachment-analysis.ts';
import type { AttachmentAnalysisSource } from '../../../../ports/attachments/attachment-analysis-source.ts';
import type { ModelProvider } from '../../../../ports/model/model-provider.ts';
import type {
  DocumentAttachment,
  ImageAttachment,
} from '../../../../domain/attachments/attachment.ts';
import {
  definition,
  requireProjectInvocation,
  requireAcceptedArtifacts,
  withArtifactAuthority,
  projectCapabilityAuthority,
  webResearchAuthority,
} from './runtime-support.ts';

export function attachmentAnalysisRegistration(options: {
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

export function planningRegistration(
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
    authorityFor: ({ hasInputArtifacts, hasDecisionEvidence }) =>
      withArtifactAuthority(
        projectCapabilityAuthority({
          destination: capability.destination,
          isolatedWorkspaceWrite: false,
        }),
        hasInputArtifacts || hasDecisionEvidence,
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

export function softwareChangeRegistration(
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
    authorityFor: ({ hasInputArtifacts, hasDecisionEvidence }) =>
      withArtifactAuthority(
        projectCapabilityAuthority({
          destination: capability.destination,
          isolatedWorkspaceWrite: true,
        }),
        hasInputArtifacts || hasDecisionEvidence,
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

export function webResearchRegistration(
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
    authorityFor: ({ hasInputArtifacts, hasDecisionEvidence }) =>
      withArtifactAuthority(
        webResearchAuthority(capability.destination),
        hasInputArtifacts || hasDecisionEvidence,
      ),
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
