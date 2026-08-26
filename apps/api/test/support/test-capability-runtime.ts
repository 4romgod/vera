import { createCapabilityRuntimeRegistry } from '../../src/adapters/outbound/capabilities/capability-runtime-registry.ts';
import { createWebResearchCapabilityRegistry } from '../../src/adapters/outbound/capabilities/web-research/web-research-adapter-registry.ts';
import type { CapabilityRuntimeRegistry } from '../../src/ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../src/ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../src/ports/capabilities/software-change-capability.ts';
import { LocalPersonalTaskActionExecutor } from '../../src/adapters/outbound/integrations/personal-tasks/local-personal-task-action-executor.ts';
import { InMemoryOwnerResourceStore } from '../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import type { PersonalTaskStore } from '../../src/ports/persistence/personal-task-store.ts';

export function createTestCapabilityRuntime(options: {
  developmentPlanning: DevelopmentPlanningCapabilityRegistry;
  softwareChange: SoftwareChangeCapabilityRegistry;
  webResearch?: 'disabled' | 'deterministic_research';
  personalTaskStore?: PersonalTaskStore;
}): CapabilityRuntimeRegistry {
  return createCapabilityRuntimeRegistry({
    developmentPlanning: options.developmentPlanning,
    softwareChange: options.softwareChange,
    webResearch: createWebResearchCapabilityRegistry({
      adapterId: options.webResearch ?? 'disabled',
    }),
    personalTasks: new LocalPersonalTaskActionExecutor(
      options.personalTaskStore ?? new InMemoryOwnerResourceStore(),
    ),
  });
}
