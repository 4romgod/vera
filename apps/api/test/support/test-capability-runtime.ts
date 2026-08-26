import { createCapabilityRuntimeRegistry } from '../../src/adapters/outbound/capabilities/capability-runtime-registry.ts';
import { createWebResearchCapabilityRegistry } from '../../src/adapters/outbound/capabilities/web-research/web-research-adapter-registry.ts';
import type { CapabilityRuntimeRegistry } from '../../src/ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../src/ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../src/ports/capabilities/software-change-capability.ts';

export function createTestCapabilityRuntime(options: {
  developmentPlanning: DevelopmentPlanningCapabilityRegistry;
  softwareChange: SoftwareChangeCapabilityRegistry;
  webResearch?: 'disabled' | 'deterministic_research';
}): CapabilityRuntimeRegistry {
  return createCapabilityRuntimeRegistry({
    developmentPlanning: options.developmentPlanning,
    softwareChange: options.softwareChange,
    webResearch: createWebResearchCapabilityRegistry({
      adapterId: options.webResearch ?? 'disabled',
    }),
  });
}
