import type { z } from 'zod';

import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type { WebResearchProposalArgumentsSchema } from '../../domain/capabilities/capability-registry.ts';
import type { ResearchReport } from '../../domain/research/research-report.ts';

export type WebResearchArguments = z.infer<
  typeof WebResearchProposalArgumentsSchema
>;

export type WebResearchInvocation = {
  schemaVersion: 1;
  invocationId: string;
  arguments: WebResearchArguments;
  limits: {
    maxDurationMs: number;
    maxArtifactBytes: number;
    maxWebSearchCalls: number;
  };
};

export type WebResearchCapability = {
  readonly destination: CapabilityDestination;
  checkReadiness(): Promise<void>;
  execute(
    invocation: WebResearchInvocation,
    options?: { signal?: AbortSignal },
  ): Promise<{
    report: ResearchReport;
    model: {
      provider: string;
      model: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    };
  }>;
};

export type WebResearchCapabilityRegistry = {
  selected(): WebResearchCapability | null;
  resolve(destination: CapabilityDestination): WebResearchCapability | null;
};
