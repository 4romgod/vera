import { DeterministicSoftwareChangeCapability } from '../../src/capabilities/deterministic-software-change-capability.ts';
import { sameCapabilityDestination } from '../../src/domain/capability-destination.ts';
import type { SoftwareChangeCapabilityRegistry } from '../../src/ports/software-change-capability.ts';

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
