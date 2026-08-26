import { z } from 'zod';

export const ResearchSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(1_000),
    url: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    }, 'Research source URLs must use HTTP or HTTPS.'),
  })
  .strict();

export const ResearchReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    objective: z.string().trim().min(1).max(10_000),
    report: z.string().trim().min(1).max(100_000),
    sources: z.array(ResearchSourceSchema).min(1).max(100),
    searchedAt: z.iso.datetime(),
  })
  .strict();

export type ResearchReport = z.infer<typeof ResearchReportSchema>;
