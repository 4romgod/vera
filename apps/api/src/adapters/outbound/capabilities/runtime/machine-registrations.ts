import { type CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import type {
  CapabilityRuntime,
  CapabilityRuntimeRegistration,
} from '../../../../ports/capabilities/capability-runtime.ts';
import type { MachineOperations } from '../../../../ports/machines/machine-operations.ts';
import {
  MachineDiagnosticSchema,
  MachineInspectionArgumentsSchema,
  MachineServiceActionArgumentsSchema,
  MachineServiceActionResultSchema,
} from '../../../../domain/machines/machine.ts';
import { definition, requireAcceptedArtifacts } from './runtime-support.ts';

function machineAuthority(
  remote: boolean,
  mutation: boolean,
  includesArtifactContent = mutation,
): CapabilityAuthority {
  return {
    approval: 'always',
    projectContext: 'none',
    networkAccess: remote ? 'owner_machine' : 'none',
    dataClasses: [
      'owner_request',
      'machine_operational_data',
      ...(includesArtifactContent ? (['artifact_content'] as const) : []),
    ],
    sideEffects: mutation ? ['machine_service_control'] : [],
    credentials: remote ? 'server_managed' : 'none',
  };
}

export function machineInspectionRegistration(
  operations: MachineOperations,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('machine_inspection');
  const runtime = (machineId: string): CapabilityRuntime => {
    const remote =
      operations.catalog.machines.find(({ id }) => id === machineId)?.adapter
        .kind === 'ssh';
    return {
      definition: capabilityDefinition,
      destination: operations.destinationFor(machineId),
      destinationFor(arguments_) {
        const parsed = MachineInspectionArgumentsSchema.parse(arguments_);
        return operations.destinationFor(parsed.machineId);
      },
      authority: machineAuthority(remote, false),
      authorityFor: ({ arguments: arguments_ }) => {
        const parsed = MachineInspectionArgumentsSchema.parse(arguments_);
        if (parsed.machineId !== machineId) {
          throw new Error(
            'Machine inspection arguments differ from the resolved destination.',
          );
        }
        return machineAuthority(remote, false);
      },
      checkReadiness: () => operations.checkReadiness(),
      async execute(invocation, options) {
        if (
          invocation.project !== undefined ||
          invocation.context !== undefined ||
          invocation.artifacts !== undefined
        ) {
          throw new Error(
            'Machine inspection must not receive project context or artifacts.',
          );
        }
        const arguments_ = MachineInspectionArgumentsSchema.parse(
          invocation.arguments,
        );
        if (arguments_.machineId !== machineId) {
          throw new Error(
            'Machine inspection arguments differ from the resolved destination.',
          );
        }
        const started = Date.now();
        const content = await operations.inspect(arguments_, options);
        return {
          artifact: {
            type: 'machine_diagnostic',
            mediaType: 'application/vnd.vera.machine-diagnostic+json',
            content: MachineDiagnosticSchema.parse(content),
          },
          model: {
            provider: 'vera',
            model: 'registered_machine_inspection',
            durationMs: Date.now() - started,
          },
        };
      },
    };
  };
  return {
    definition: capabilityDefinition,
    catalog: { authority: capabilityDefinition.authority },
    selected: () => {
      const first = operations.catalog.machines[0];
      return first === undefined ? null : runtime(first.id);
    },
    resolve(destination) {
      const machineId = operations.resolve(destination);
      return machineId === null ? null : runtime(machineId);
    },
  };
}

export function machineServiceRegistration(
  operations: MachineOperations,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('machine_service_management');
  const runtime = (machineId: string): CapabilityRuntime => {
    const remote =
      operations.catalog.machines.find(({ id }) => id === machineId)?.adapter
        .kind === 'ssh';
    return {
      definition: capabilityDefinition,
      destination: operations.destinationFor(machineId),
      destinationFor(arguments_) {
        const parsed = MachineServiceActionArgumentsSchema.parse(arguments_);
        return operations.destinationFor(parsed.machineId);
      },
      authority: machineAuthority(remote, true),
      authorityFor: ({
        arguments: arguments_,
        hasInputArtifacts,
        hasDecisionEvidence,
      }) => {
        const parsed = MachineServiceActionArgumentsSchema.parse(arguments_);
        if (parsed.machineId !== machineId) {
          throw new Error(
            'Machine service arguments differ from the resolved destination.',
          );
        }
        return machineAuthority(
          remote,
          true,
          hasInputArtifacts || hasDecisionEvidence,
        );
      },
      checkReadiness: () => operations.checkReadiness(),
      async execute(invocation, options) {
        if (
          invocation.project !== undefined ||
          invocation.context !== undefined
        ) {
          throw new Error(
            'Machine service management must not receive project context.',
          );
        }
        const arguments_ = MachineServiceActionArgumentsSchema.parse(
          invocation.arguments,
        );
        if (arguments_.machineId !== machineId) {
          throw new Error(
            'Machine service arguments differ from the resolved destination.',
          );
        }
        for (const artifact of requireAcceptedArtifacts(
          invocation,
          capabilityDefinition,
        )) {
          const diagnostic = MachineDiagnosticSchema.parse(artifact.content);
          if (
            diagnostic.machine.id !== arguments_.machineId ||
            !diagnostic.services.some(({ id }) => id === arguments_.serviceId)
          ) {
            throw new Error(
              'The diagnostic evidence does not match the approved machine service action.',
            );
          }
        }
        const started = Date.now();
        const content = await operations.manageService(arguments_, {
          recovery: invocation.recovery,
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return {
          artifact: {
            type: 'machine_service_action_result',
            mediaType:
              'application/vnd.vera.machine-service-action-result+json',
            content: MachineServiceActionResultSchema.parse(content),
          },
          model: {
            provider: 'vera',
            model: 'registered_machine_service',
            durationMs: Date.now() - started,
          },
        };
      },
    };
  };
  return {
    definition: capabilityDefinition,
    catalog: { authority: capabilityDefinition.authority },
    selected: () => {
      const first = operations.catalog.machines[0];
      return first === undefined ? null : runtime(first.id);
    },
    resolve(destination) {
      const machineId = operations.resolve(destination);
      return machineId === null ? null : runtime(machineId);
    },
  };
}
