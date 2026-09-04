import { type CapabilityReference } from '../../../domain/capabilities/capability-registry.ts';
import {
  type PersonalTaskActionArguments,
  type PersonalTaskResult,
} from '../../../domain/personal-tasks/personal-task.ts';
import { type CapabilityDestination } from '../../../domain/capabilities/capability-destination.ts';
import type { CapabilityRuntimeRegistry } from '../../../ports/capabilities/capability-runtime.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../../../ports/capabilities/development-planning-capability.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../../ports/capabilities/software-change-capability.ts';
import type { WebResearchCapabilityRegistry } from '../../../ports/capabilities/web-research-capability.ts';
import type { IntegrationActionExecutor } from '../../../ports/integrations/integration-action-executor.ts';
import {
  type ReminderActionArguments,
  type ReminderResult,
} from '../../../domain/reminders/reminder.ts';
import {
  type MemoryActionArguments,
  type MemoryResult,
} from '../../../domain/memories/memory.ts';
import type { AttachmentAnalysisSource } from '../../../ports/attachments/attachment-analysis-source.ts';
import type { ModelProvider } from '../../../ports/model/model-provider.ts';
import type { MachineOperations } from '../../../ports/machines/machine-operations.ts';
import {
  type MissionManagementResult,
  type MissionProposalArguments,
} from '../../../domain/missions/mission.ts';
import type { KnowledgeService } from '../../../ports/knowledge/knowledge-service.ts';
import type { AttentionService } from '../../../ports/attention/attention-service.ts';
import type { RoutineManagementService } from '../../../ports/routines/routine-management-service.ts';
import type {
  SoftwareDeliveryActionArguments,
  SoftwareDeliveryManagementResult,
} from '../../../domain/software-delivery/software-delivery-management.ts';
import { knowledgeRegistration } from './runtime/knowledge-registration.ts';
import {
  machineInspectionRegistration,
  machineServiceRegistration,
} from './runtime/machine-registrations.ts';
import {
  attentionRegistration,
  memoryRegistration,
  missionRegistration,
  personalTaskRegistration,
  reminderRegistration,
  routineRegistration,
  softwareDeliveryRegistration,
} from './runtime/owner-registrations.ts';
import {
  attachmentAnalysisRegistration,
  planningRegistration,
  softwareChangeRegistration,
  webResearchRegistration,
} from './runtime/project-registrations.ts';
import { sameReference } from './runtime/runtime-support.ts';

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
  knowledge?: KnowledgeService;
  missions?: IntegrationActionExecutor<
    MissionProposalArguments,
    MissionManagementResult
  >;
  machines?: MachineOperations;
  attention?: AttentionService;
  routines?: { lifecycle: RoutineManagementService; wake: () => void };
  softwareDeliveryManagement?: IntegrationActionExecutor<
    SoftwareDeliveryActionArguments,
    SoftwareDeliveryManagementResult
  >;
  softwareDeliveryRepair?: IntegrationActionExecutor<
    SoftwareDeliveryActionArguments,
    SoftwareDeliveryManagementResult
  >;
}): CapabilityRuntimeRegistry {
  const registrations = [
    ...(options.softwareDeliveryManagement === undefined
      ? []
      : [
          softwareDeliveryRegistration(
            options.softwareDeliveryManagement,
            'software_delivery_management',
          ),
        ]),
    ...(options.softwareDeliveryRepair === undefined
      ? []
      : [
          softwareDeliveryRegistration(
            options.softwareDeliveryRepair,
            'software_delivery_repair',
          ),
        ]),
    ...(options.attention === undefined
      ? []
      : [attentionRegistration(options.attention)]),
    ...(options.routines === undefined
      ? []
      : [
          routineRegistration(
            options.routines.lifecycle,
            options.routines.wake,
          ),
        ]),
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
    ...(options.knowledge === undefined
      ? []
      : [
          knowledgeRegistration({
            knowledge: options.knowledge,
            provider: options.provider,
          }),
        ]),
    ...(options.missions === undefined
      ? []
      : [missionRegistration(options.missions)]),
    ...(options.machines === undefined
      ? []
      : [
          machineInspectionRegistration(options.machines),
          machineServiceRegistration(options.machines),
        ]),
  ];
  const registrationFor = (reference: CapabilityReference) =>
    registrations.find((candidate) =>
      sameReference(candidate.definition, reference),
    );
  return {
    declarations: () =>
      registrations.map((registration) => {
        const selected = registration.selected();
        const catalog =
          registration.catalog ??
          (selected === null
            ? { authority: registration.definition.authority }
            : {
                authority: selected.authority,
                destination: selected.destination,
              });
        return {
          definition: registration.definition,
          authority: catalog.authority,
          enabled: selected !== null,
          ...(catalog.destination === undefined
            ? {}
            : { destination: catalog.destination }),
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
