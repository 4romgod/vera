import type { z } from 'zod';

import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type { SoftwareChangeProposalArgumentsSchema } from '../../domain/capabilities/capability-registry.ts';
import type { ProjectContextBundle } from '../../domain/projects/project-context.ts';
import type { SoftwareChange } from '../../domain/changes/software-change.ts';

export type SoftwareChangeArguments = z.infer<
  typeof SoftwareChangeProposalArgumentsSchema
>;

export type SoftwareChangeInvocation = {
  schemaVersion: 1;
  invocationId: string;
  arguments: SoftwareChangeArguments;
  project: { id: string; displayName: string };
  context: ProjectContextBundle;
  limits: {
    maxDurationMs: number;
    maxArtifactBytes: number;
    maxChangedFiles: number;
  };
};

export type SoftwareChangeCapability = {
  readonly destination: CapabilityDestination;
  checkReadiness(): Promise<void>;
  execute(
    invocation: SoftwareChangeInvocation,
    options?: { signal?: AbortSignal },
  ): Promise<{
    change: SoftwareChange;
    model: {
      provider: string;
      model: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    };
  }>;
};

export type SoftwareChangeCapabilityRegistry = {
  selected(): SoftwareChangeCapability;
  resolve(destination: CapabilityDestination): SoftwareChangeCapability | null;
};
