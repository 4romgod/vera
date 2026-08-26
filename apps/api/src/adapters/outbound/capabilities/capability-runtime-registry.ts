import {
  CapabilityDefinitions,
  DevelopmentPlanningProposalArgumentsSchema,
  SoftwareChangeProposalArgumentsSchema,
  WebResearchProposalArgumentsSchema,
  type CapabilityDefinition,
  type CapabilityAuthority,
  type CapabilityReference,
} from '../../../domain/capabilities/capability-registry.ts';
import { DevelopmentPlanSchema } from '../../../domain/plans/development-plan.ts';
import { SoftwareChangeSchema } from '../../../domain/changes/software-change.ts';
import { ResearchReportSchema } from '../../../domain/research/research-report.ts';
import type { CapabilityDestination } from '../../../domain/capabilities/capability-destination.ts';
import type {
  CapabilityRuntime,
  CapabilityRuntimeRegistration,
  CapabilityRuntimeRegistry,
} from '../../../ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../../ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../../ports/capabilities/software-change-capability.ts';
import type { WebResearchCapabilityRegistry } from '../../../ports/capabilities/web-research-capability.ts';

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

function projectCapabilityAuthority(options: {
  destination: CapabilityDestination;
  isolatedWorkspaceWrite: boolean;
}): CapabilityAuthority {
  const thirdParty = options.destination.dataBoundary === 'third_party';
  return {
    approval: 'always',
    projectContext: 'required',
    networkAccess: thirdParty ? 'provider_api' : 'none',
    dataClasses: ['owner_request', 'project_context'],
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
    checkReadiness: () => capability.checkReadiness(),
    async execute(invocation, options) {
      const { project, context } = requireProjectInvocation(invocation);
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
    checkReadiness: () => capability.checkReadiness(),
    async execute(invocation, options) {
      const { project, context } = requireProjectInvocation(invocation);
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
    checkReadiness: () => capability.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined
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
  developmentPlanning: DevelopmentPlanningCapabilityRegistry;
  softwareChange: SoftwareChangeCapabilityRegistry;
  webResearch: WebResearchCapabilityRegistry;
}): CapabilityRuntimeRegistry {
  const registrations = [
    planningRegistration(options.developmentPlanning),
    softwareChangeRegistration(options.softwareChange),
    webResearchRegistration(options.webResearch),
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
