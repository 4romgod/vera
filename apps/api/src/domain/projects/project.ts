import { z } from 'zod';

export const LocalGitProjectSourceSchema = z
  .object({
    kind: z.literal('local_git'),
    rootPath: z.string().min(1),
  })
  .strict();

export const ProjectSourceSchema = z.discriminatedUnion('kind', [
  LocalGitProjectSourceSchema,
]);

export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('project_'),
    principalId: z.string().min(1),
    registrationKey: z.string().min(1),
    displayName: z.string().trim().min(1).max(200),
    normalizedName: z.string().trim().min(1).max(200),
    source: ProjectSourceSchema,
    status: z.literal('active'),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type Project = z.infer<typeof ProjectSchema>;
