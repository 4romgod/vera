import {
  sameCapabilityDestination,
  type CapabilityDestination,
} from '../../../../domain/capabilities/capability-destination.ts';
import type {
  SoftwareChangeCapability,
  SoftwareChangeCapabilityRegistry,
} from '../../../../ports/capabilities/software-change-capability.ts';
import { CodexSoftwareChangeCapability } from './codex-software-change-capability.ts';
import { DeterministicSoftwareChangeCapability } from './deterministic-software-change-capability.ts';

export type SoftwareChangeAdapterConfig = {
  adapterId: string;
  codexCli: { command: string; model?: string };
  dependencyTimeoutMs: number;
};

type AdapterFactory = (
  config: SoftwareChangeAdapterConfig,
) => SoftwareChangeCapability;

const adapterAliases = new Map<string, string>([
  ['codex', 'codex_cli'],
  ['deterministic', 'deterministic_change'],
]);

const adapterFactories = new Map<string, AdapterFactory>([
  [
    'codex_cli',
    (config) =>
      new CodexSoftwareChangeCapability({
        command: config.codexCli.command,
        readinessTimeoutMs: config.dependencyTimeoutMs,
        ...(config.codexCli.model === undefined
          ? {}
          : { model: config.codexCli.model }),
      }),
  ],
  ['deterministic_change', () => new DeterministicSoftwareChangeCapability()],
]);

export function canonicalSoftwareChangeAdapterId(adapterId: string): string {
  return adapterAliases.get(adapterId) ?? adapterId;
}

export function createSoftwareChangeCapabilityRegistry(
  config: SoftwareChangeAdapterConfig,
): SoftwareChangeCapabilityRegistry {
  const instances = new Map<string, SoftwareChangeCapability>();
  const get = (configuredId: string): SoftwareChangeCapability | null => {
    const adapterId = canonicalSoftwareChangeAdapterId(configuredId);
    const existing = instances.get(adapterId);
    if (existing !== undefined) return existing;
    const factory = adapterFactories.get(adapterId);
    if (factory === undefined) return null;
    const capability = factory(config);
    instances.set(adapterId, capability);
    return capability;
  };
  const selectedId = canonicalSoftwareChangeAdapterId(config.adapterId);
  const selected = get(selectedId);
  if (selected === null) {
    throw new Error(
      `Unknown software-change adapter "${selectedId}". Registered adapters: ${[
        ...adapterFactories.keys(),
      ].join(', ')}.`,
    );
  }
  return {
    selected: () => selected,
    resolve(destination: CapabilityDestination) {
      const capability = get(destination.adapterId);
      return capability !== null &&
        sameCapabilityDestination(capability.destination, destination)
        ? capability
        : null;
    },
  };
}
