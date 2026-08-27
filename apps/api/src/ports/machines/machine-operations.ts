import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type {
  MachineCatalog,
  MachineDiagnostic,
  MachineInspectionArguments,
  MachineServiceActionArguments,
  MachineServiceActionResult,
} from '../../domain/machines/machine.ts';

export type MachineOperations = {
  readonly catalog: MachineCatalog;
  destinationFor(machineId: string): CapabilityDestination;
  resolve(destination: CapabilityDestination): string | null;
  checkReadiness(): Promise<void>;
  inspect(
    arguments_: MachineInspectionArguments,
    options?: { signal?: AbortSignal },
  ): Promise<MachineDiagnostic>;
  manageService(
    arguments_: MachineServiceActionArguments,
    options: { recovery: boolean; signal?: AbortSignal },
  ): Promise<MachineServiceActionResult>;
};
