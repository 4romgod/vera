import { z } from 'zod';

export const MissionProposalArgumentsSchema = z
  .object({
    action: z.literal('create'),
    objective: z.string().trim().min(1).max(10_000),
    completionCriteria: z.string().trim().min(1).max(2_000),
    project: z.object({ name: z.string().trim().min(1).max(200) }).strict(),
    delivery: z
      .object({
        commitMessage: z.string().trim().min(1).max(5_000),
        pullRequestTitle: z.string().trim().min(1).max(256),
      })
      .strict(),
  })
  .strict();

export type MissionProposalArguments = z.infer<
  typeof MissionProposalArgumentsSchema
>;
