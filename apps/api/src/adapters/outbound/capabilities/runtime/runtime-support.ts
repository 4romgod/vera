import {
  CapabilityDefinitions,
  type CapabilityDefinition,
  type CapabilityAuthority,
  type CapabilityReference,
} from '../../../../domain/capabilities/capability-registry.ts';
import { type CapabilityDestination } from '../../../../domain/capabilities/capability-destination.ts';
import type { CapabilityRuntime } from '../../../../ports/capabilities/capability-runtime.ts';

export function definition(name: string): CapabilityDefinition {
  const value = CapabilityDefinitions.find(
    (candidate) => candidate.name === name && candidate.version === 1,
  );
  if (value === undefined) throw new Error(`Capability ${name}@1 is missing.`);
  return value;
}

export function requireProjectInvocation(
  invocation: Parameters<CapabilityRuntime['execute']>[0],
) {
  if (invocation.project === undefined || invocation.context === undefined) {
    throw new Error('The project capability invocation is missing context.');
  }
  return { project: invocation.project, context: invocation.context };
}

export function requireAcceptedArtifacts(
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

export function withArtifactAuthority(
  authority: CapabilityAuthority,
  includesArtifactContent: boolean,
): CapabilityAuthority {
  const dataClasses = authority.dataClasses.filter(
    (dataClass) => dataClass !== 'artifact_content',
  );
  return {
    ...authority,
    dataClasses: includesArtifactContent
      ? [...dataClasses, 'artifact_content']
      : dataClasses,
  };
}

export function maximumArtifactAwareAuthority(
  authority: CapabilityAuthority,
): CapabilityAuthority {
  return withArtifactAuthority(authority, true);
}

export function projectCapabilityAuthority(options: {
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

export function webResearchAuthority(
  destination: CapabilityDestination,
): CapabilityAuthority {
  const thirdParty = destination.dataBoundary === 'third_party';
  return {
    approval: 'always',
    projectContext: 'none',
    networkAccess: thirdParty ? 'public_web_via_provider' : 'none',
    dataClasses: ['owner_request', 'artifact_content', 'public_web'],
    sideEffects: thirdParty
      ? ['third_party_disclosure', 'public_network_read']
      : [],
    credentials: thirdParty ? 'server_managed' : 'none',
    maxWebSearchCalls: 4,
  };
}

export function sameReference(
  definition_: CapabilityDefinition,
  reference: CapabilityReference,
): boolean {
  return (
    definition_.name === reference.name &&
    definition_.version === reference.version
  );
}
