import { z } from 'zod';

const DevelopmentPlanPhaseSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(1_000),
    steps: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
    verification: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  })
  .strict();

const AffectedProjectAreaSchema = z
  .object({
    area: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const DevelopmentPlanContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2_000),
    scope: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
    nonGoals: z.array(z.string().trim().min(1).max(1_000)).max(20),
    assumptions: z.array(z.string().trim().min(1).max(1_000)).max(20),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(1_000)).max(20),
    affectedProjectAreas: z.array(AffectedProjectAreaSchema).max(50),
    phases: z.array(DevelopmentPlanPhaseSchema).min(1).max(20),
    risks: z.array(z.string().trim().min(1).max(1_000)).max(20),
  })
  .strict();

export const DevelopmentPlanSchema = DevelopmentPlanContentSchema.extend({
  project: z
    .object({
      name: z.string().trim().min(1).max(200),
      id: z.string().startsWith('project_').optional(),
      revision: z.string().min(1).max(200).optional(),
    })
    .strict(),
  ticket: z
    .object({
      reference: z.string().trim().min(1).max(200),
      details: z.string().trim().min(1).max(20_000),
    })
    .strict(),
  objective: z.string().trim().min(1).max(10_000),
}).strict();

export type DevelopmentPlan = z.infer<typeof DevelopmentPlanSchema>;

export const DevelopmentPlanContentJsonSchema = z.toJSONSchema(
  DevelopmentPlanContentSchema,
  { target: 'draft-7' },
);
