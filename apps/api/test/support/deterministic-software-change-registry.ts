import { DeterministicSoftwareChangeCapability } from '../../src/adapters/outbound/capabilities/software-change/deterministic-software-change-capability.ts';
import { sameCapabilityDestination } from '../../src/domain/capabilities/capability-destination.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../src/ports/capabilities/software-change-capability.ts';

export function createDeterministicSoftwareChangeRegistry(): SoftwareChangeCapabilityRegistry {
  const capability = new DeterministicSoftwareChangeCapability();
  return {
    selected: () => capability,
    resolve: (destination) =>
      sameCapabilityDestination(capability.destination, destination)
        ? capability
        : null,
  };
}
