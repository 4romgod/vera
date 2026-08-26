import { z } from 'zod';

export const RunBudgetSchema = z
  .object({
    limits: z
      .object({
        modelCalls: z.number().int().positive(),
        capabilityInvocations: z.number().int().positive(),
        retries: z.number().int().nonnegative(),
        maxDurationMs: z.number().int().positive(),
        maxContextFiles: z.number().int().positive(),
        maxContextBytes: z.number().int().positive(),
        maxContextFileBytes: z.number().int().positive(),
        maxArtifactBytes: z.number().int().positive(),
      })
      .strict(),
    consumed: z
      .object({
        modelCalls: z.number().int().nonnegative(),
        capabilityInvocations: z.number().int().nonnegative(),
        retries: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type RunBudget = z.infer<typeof RunBudgetSchema>;

export const DefaultRunBudget: RunBudget = {
  limits: {
    modelCalls: 4,
    capabilityInvocations: 3,
    retries: 1,
    maxDurationMs: 600_000,
    maxContextFiles: 40,
    maxContextBytes: 200_000,
    maxContextFileBytes: 40_000,
    maxArtifactBytes: 100_000,
  },
  consumed: {
    modelCalls: 0,
    capabilityInvocations: 0,
    retries: 0,
  },
};
