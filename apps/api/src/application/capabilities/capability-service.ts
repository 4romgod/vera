import {
  CapabilityCatalogSchema,
  type CapabilityCatalog,
} from '../../domain/capabilities/capability-registry.ts';
import type { CapabilityRuntimeRegistry } from '../../ports/capabilities/capability-runtime.ts';

export type CapabilityService = {
  list(): CapabilityCatalog;
};

export function createCapabilityService(options: {
  registry: CapabilityRuntimeRegistry;
}): CapabilityService {
  return {
    list() {
      return CapabilityCatalogSchema.parse({
        schemaVersion: 1,
        capabilities: options.registry.declarations().map((declaration) => ({
          name: declaration.definition.name,
          version: declaration.definition.version,
          description: declaration.definition.description,
          effect: declaration.definition.effect,
          artifact: declaration.definition.artifact,
          authority: declaration.authority,
          enabled: declaration.enabled,
          ...(declaration.destination === undefined
            ? {}
            : { destination: declaration.destination }),
        })),
      });
    },
  };
}
