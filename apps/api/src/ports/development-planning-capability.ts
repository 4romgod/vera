import type { z } from 'zod';

import type { DevelopmentPlanningProposalArgumentsSchema } from '../domain/capability-registry.ts';
import type { DevelopmentPlan } from '../domain/development-plan.ts';

export type DevelopmentPlanningArguments = z.infer<
  typeof DevelopmentPlanningProposalArgumentsSchema
>;

export type DevelopmentPlanningCapability = {
  execute(
    arguments_: DevelopmentPlanningArguments,
    invocationId: string,
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
