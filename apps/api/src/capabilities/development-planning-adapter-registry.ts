import type { AppConfig } from '../config.ts';
import {
  sameCapabilityDestination,
  type CapabilityDestination,
} from '../domain/capability-destination.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type {
  DevelopmentPlanningCapability,
  DevelopmentPlanningCapabilityRegistry,
} from '../ports/development-planning-capability.ts';
import { CodexDevelopmentPlanningCapability } from './codex-development-planning-capability.ts';
import { ModelDevelopmentPlanningCapability } from './model-development-planning-capability.ts';

type AdapterFactoryContext = {
  config: AppConfig;
  provider: ModelProvider;
};

type AdapterFactory = (
  context: AdapterFactoryContext,
) => DevelopmentPlanningCapability;

const adapterAliases = new Map<string, string>([
  ['codex', 'codex_cli'],
  ['model', 'structured_model'],
]);

const adapterFactories = new Map<string, AdapterFactory>([
  [
    'codex_cli',
    ({ config }) =>
      new CodexDevelopmentPlanningCapability({
        command: config.planning.adapters.codexCli.command,
        readinessTimeoutMs: config.storage.dependencyTimeoutMs,
        ...(config.planning.adapters.codexCli.model === undefined
          ? {}
          : { model: config.planning.adapters.codexCli.model }),
      }),
  ],
  [
    'structured_model',
    ({ provider }) => new ModelDevelopmentPlanningCapability(provider),
  ],
]);

export function canonicalPlanningAdapterId(adapterId: string): string {
  return adapterAliases.get(adapterId) ?? adapterId;
}

export function createDevelopmentPlanningCapabilityRegistry(
  context: AdapterFactoryContext,
): DevelopmentPlanningCapabilityRegistry {
  const instances = new Map<string, DevelopmentPlanningCapability>();

  const get = (configuredId: string): DevelopmentPlanningCapability | null => {
    const adapterId = canonicalPlanningAdapterId(configuredId);
    const existing = instances.get(adapterId);
    if (existing !== undefined) return existing;
    const factory = adapterFactories.get(adapterId);
    if (factory === undefined) return null;
    const capability = factory(context);
    instances.set(adapterId, capability);
    return capability;
  };

  const selectedAdapterId = canonicalPlanningAdapterId(
    context.config.planning.adapterId,
  );
  const selected = get(selectedAdapterId);
  if (selected === null) {
    throw new Error(
      `Unknown development-planning adapter "${selectedAdapterId}". Registered adapters: ${[
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
