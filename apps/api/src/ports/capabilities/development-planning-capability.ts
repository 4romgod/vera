import type { z } from 'zod';

import type { DevelopmentPlanningProposalArgumentsSchema } from '../../domain/capabilities/capability-registry.ts';
import type { DevelopmentPlan } from '../../domain/plans/development-plan.ts';
import type { ProjectContextBundle } from '../../domain/projects/project-context.ts';
import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type { Artifact } from '../../domain/artifacts/artifact.ts';

export type DevelopmentPlanningArguments = z.infer<
  typeof DevelopmentPlanningProposalArgumentsSchema
>;

export type DevelopmentPlanningInvocation = {
  schemaVersion: 1;
  invocationId: string;
  arguments: DevelopmentPlanningArguments;
  project: { id: string; displayName: string };
  context: ProjectContextBundle;
  artifacts?: Artifact[];
  limits: { maxDurationMs: number; maxArtifactBytes: number };
};

export type DevelopmentPlanningCapability = {
  readonly destination: CapabilityDestination;
  checkReadiness(): Promise<void>;
  execute(
    invocation: DevelopmentPlanningInvocation,
    options?: { signal?: AbortSignal },
  ): Promise<{
    plan: DevelopmentPlan;
    model: {
      provider: string;
      model: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    };
  }>;
};

export type DevelopmentPlanningCapabilityRegistry = {
  selected(): DevelopmentPlanningCapability;
  resolve(
    destination: CapabilityDestination,
  ): DevelopmentPlanningCapability | null;
};
