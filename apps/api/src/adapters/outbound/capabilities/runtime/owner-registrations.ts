import {
  PersonalTaskActionArgumentsSchema,
  PersonalTaskResultSchema,
  type PersonalTaskActionArguments,
  type PersonalTaskResult,
} from '../../../../domain/personal-tasks/personal-task.ts';
import { sameCapabilityDestination } from '../../../../domain/capabilities/capability-destination.ts';
import type {
  CapabilityRuntime,
  CapabilityRuntimeRegistration,
} from '../../../../ports/capabilities/capability-runtime.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import {
  ReminderActionArgumentsSchema,
  ReminderResultSchema,
  type ReminderActionArguments,
  type ReminderResult,
} from '../../../../domain/reminders/reminder.ts';
import {
  MemoryActionArgumentsSchema,
  MemoryResultSchema,
  type MemoryActionArguments,
  type MemoryResult,
} from '../../../../domain/memories/memory.ts';
import {
  MissionManagementResultSchema,
  MissionProposalArgumentsSchema,
  type MissionManagementResult,
  type MissionProposalArguments,
} from '../../../../domain/missions/mission.ts';
import {
  AttentionActionArgumentsSchema,
  AttentionResultSchema,
} from '../../../../domain/attention/attention.ts';
import type { AttentionService } from '../../../../ports/attention/attention-service.ts';
import {
  RoutineManagementArgumentsSchema,
  RoutineManagementResultSchema,
} from '../../../../domain/routines/routine.ts';
import type { RoutineManagementService } from '../../../../ports/routines/routine-management-service.ts';
import {
  SoftwareDeliveryManagementArgumentsSchema,
  SoftwareDeliveryRepairArgumentsSchema,
  SoftwareDeliveryManagementResultSchema,
  type SoftwareDeliveryActionArguments,
  type SoftwareDeliveryManagementResult,
} from '../../../../domain/software-delivery/software-delivery-management.ts';
import {
  definition,
  maximumArtifactAwareAuthority,
  withArtifactAuthority,
} from './runtime-support.ts';

export function attentionRegistration(
  attention: AttentionService,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('attention_management');
  const destination = {
    schemaVersion: 1 as const,
    adapterId: 'vera_attention',
    provider: 'vera',
    transport: 'local_store',
    dataBoundary: 'owner_controlled' as const,
  };
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination,
    authority: capabilityDefinition.authority,
    authorityFor({ arguments: arguments_ }) {
      AttentionActionArgumentsSchema.parse(arguments_);
      return capabilityDefinition.authority;
    },
    checkReadiness: () => Promise.resolve(),
    async execute(invocation) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined ||
        invocation.attachments !== undefined
      ) {
        throw new Error(
          'Attention briefing must not receive external context.',
        );
      }
      AttentionActionArgumentsSchema.parse(invocation.arguments);
      const started = Date.now();
      const briefing = await attention.getBriefing(invocation.principalId);
      return {
        artifact: {
          type: 'attention_result',
          mediaType: 'application/vnd.vera.attention-result+json',
          content: AttentionResultSchema.parse({
            schemaVersion: 1,
            action: 'brief',
            summary: briefing.summary,
            briefing,
          }),
        },
        model: {
          provider: 'vera',
          model: 'deterministic_attention_v1',
          durationMs: Date.now() - started,
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

export function softwareDeliveryRegistration(
  executor: IntegrationActionExecutor<
    SoftwareDeliveryActionArguments,
    SoftwareDeliveryManagementResult
  >,
  capabilityName: 'software_delivery_management' | 'software_delivery_repair',
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition(capabilityName);
  const parseArguments = (value: unknown) =>
    capabilityName === 'software_delivery_management'
      ? SoftwareDeliveryManagementArgumentsSchema.parse(value)
      : SoftwareDeliveryRepairArgumentsSchema.parse(value);
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: executor.maximumAuthority,
    authorityFor({ arguments: arguments_ }) {
      return executor.authorityFor(parseArguments(arguments_));
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined ||
        invocation.attachments !== undefined
      ) {
        throw new Error(
          'Software-delivery capabilities must not receive external context.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: parseArguments(invocation.arguments),
          ...(invocation.source === undefined
            ? {}
            : { source: invocation.source }),
        },
        options,
      );
      return {
        artifact: {
          type: 'software_delivery_management_result',
          mediaType:
            'application/vnd.vera.software-delivery-management-result+json',
          content: SoftwareDeliveryManagementResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

export function routineRegistration(
  routines: RoutineManagementService,
  wake: () => void,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('routine_management');
  const destination = {
    schemaVersion: 1 as const,
    adapterId: 'vera_routines',
    provider: 'vera',
    transport: 'local_store',
    dataBoundary: 'owner_controlled' as const,
  };
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination,
    authority: capabilityDefinition.authority,
    authorityFor({ arguments: arguments_ }) {
      RoutineManagementArgumentsSchema.parse(arguments_);
      return capabilityDefinition.authority;
    },
    checkReadiness: () => Promise.resolve(),
    async execute(invocation) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined ||
        invocation.attachments !== undefined
      ) {
        throw new Error(
          'Routine management must not receive external context.',
        );
      }
      const started = Date.now();
      const result = await routines.invoke({
        principalId: invocation.principalId,
        requestKey: invocation.invocationId,
        arguments: RoutineManagementArgumentsSchema.parse(invocation.arguments),
      });
      wake();
      return {
        artifact: {
          type: 'routine_management_result',
          mediaType: 'application/vnd.vera.routine-management-result+json',
          content: RoutineManagementResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: 'deterministic_routines_v1',
          durationMs: Date.now() - started,
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

export function personalTaskRegistration(
  executor: IntegrationActionExecutor<
    PersonalTaskActionArguments,
    PersonalTaskResult
  >,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('personal_task_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: maximumArtifactAwareAuthority(executor.maximumAuthority),
    authorityFor({ arguments: arguments_, hasDecisionEvidence }) {
      return withArtifactAuthority(
        executor.authorityFor(
          PersonalTaskActionArgumentsSchema.parse(arguments_),
        ),
        hasDecisionEvidence,
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Personal task management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: PersonalTaskActionArgumentsSchema.parse(
            invocation.arguments,
          ),
        },
        options,
      );
      return {
        artifact: {
          type: 'personal_task_result',
          mediaType: 'application/vnd.vera.personal-task-result+json',
          content: PersonalTaskResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

export function missionRegistration(
  executor: IntegrationActionExecutor<
    MissionProposalArguments,
    MissionManagementResult
  >,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('mission_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: executor.maximumAuthority,
    authorityFor({ arguments: arguments_ }) {
      return executor.authorityFor(
        MissionProposalArgumentsSchema.parse(arguments_),
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Mission management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: MissionProposalArgumentsSchema.parse(invocation.arguments),
          ...(invocation.source === undefined
            ? {}
            : { source: invocation.source }),
        },
        options,
      );
      return {
        artifact: {
          type: 'mission_management_result',
          mediaType: 'application/vnd.vera.mission-management-result+json',
          content: MissionManagementResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

export function reminderRegistration(
  executor: IntegrationActionExecutor<ReminderActionArguments, ReminderResult>,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('personal_reminder_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: maximumArtifactAwareAuthority(executor.maximumAuthority),
    authorityFor({ arguments: arguments_, hasDecisionEvidence }) {
      return withArtifactAuthority(
        executor.authorityFor(ReminderActionArgumentsSchema.parse(arguments_)),
        hasDecisionEvidence,
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Reminder management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: ReminderActionArgumentsSchema.parse(invocation.arguments),
        },
        options,
      );
      return {
        artifact: {
          type: 'personal_reminder_result',
          mediaType: 'application/vnd.vera.personal-reminder-result+json',
          content: ReminderResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}

export function memoryRegistration(
  executor: IntegrationActionExecutor<MemoryActionArguments, MemoryResult>,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('memory_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: maximumArtifactAwareAuthority(executor.maximumAuthority),
    authorityFor({ arguments: arguments_, hasDecisionEvidence }) {
      return withArtifactAuthority(
        executor.authorityFor(MemoryActionArgumentsSchema.parse(arguments_)),
        hasDecisionEvidence,
      );
    },
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project !== undefined ||
        invocation.context !== undefined ||
        invocation.artifacts !== undefined
      ) {
        throw new Error(
          'Memory management must not receive project context or artifacts.',
        );
      }
      const started = Date.now();
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: MemoryActionArgumentsSchema.parse(invocation.arguments),
          ...(invocation.source === undefined
            ? {}
            : { source: invocation.source }),
        },
        options,
      );
      return {
        artifact: {
          type: 'memory_result',
          mediaType: 'application/vnd.vera.memory-result+json',
          content: MemoryResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Date.now() - started,
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    selected: runtime,
    resolve(destination) {
      return sameCapabilityDestination(executor.destination, destination)
        ? runtime()
        : null;
    },
  };
}
