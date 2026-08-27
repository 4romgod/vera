import { createCapabilityRuntimeRegistry } from '../../src/adapters/outbound/capabilities/capability-runtime-registry.ts';
import { createWebResearchCapabilityRegistry } from '../../src/adapters/outbound/capabilities/web-research/web-research-adapter-registry.ts';
import type { CapabilityRuntimeRegistry } from '../../src/ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../src/ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../src/ports/capabilities/software-change-capability.ts';
import { LocalPersonalTaskActionExecutor } from '../../src/adapters/outbound/integrations/personal-tasks/local-personal-task-action-executor.ts';
import { InMemoryOwnerResourceStore } from '../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import type { PersonalTaskStore } from '../../src/ports/persistence/personal-task-store.ts';
import { LocalReminderActionExecutor } from '../../src/adapters/outbound/integrations/reminders/local-reminder-action-executor.ts';
import type { ReminderStore } from '../../src/ports/persistence/reminder-store.ts';
import { LocalMemoryActionExecutor } from '../../src/adapters/outbound/integrations/memories/local-memory-action-executor.ts';
import { DeterministicModelProvider } from '../../src/adapters/outbound/model/deterministic-model-provider.ts';
import { InMemoryAttachmentStore } from '../../src/adapters/outbound/persistence/memory/in-memory-attachment-store.ts';
import { createAttachmentService } from '../../src/application/attachments/attachment-service.ts';

export function createTestCapabilityRuntime(options: {
  developmentPlanning: DevelopmentPlanningCapabilityRegistry;
  softwareChange: SoftwareChangeCapabilityRegistry;
  webResearch?: 'disabled' | 'deterministic_research';
  personalTaskStore?: PersonalTaskStore;
  reminderStore?: ReminderStore;
}): CapabilityRuntimeRegistry {
  const defaultStore = new InMemoryOwnerResourceStore();
  const provider = new DeterministicModelProvider();
  return createCapabilityRuntimeRegistry({
    provider,
    attachments: createAttachmentService({
      store: new InMemoryAttachmentStore(),
    }),
    developmentPlanning: options.developmentPlanning,
    softwareChange: options.softwareChange,
    webResearch: createWebResearchCapabilityRegistry({
      adapterId: options.webResearch ?? 'disabled',
    }),
    personalTasks: new LocalPersonalTaskActionExecutor(
      options.personalTaskStore ?? defaultStore,
    ),
    reminders: new LocalReminderActionExecutor(
      options.reminderStore ?? defaultStore,
    ),
    memories: new LocalMemoryActionExecutor(defaultStore),
  });
}
