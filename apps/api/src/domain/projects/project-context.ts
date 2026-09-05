import { z } from 'zod';

export const ProjectContextEntrySchema = z
  .object({
    relativePath: z.string().min(1).max(1_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
    selectionReason: z.string().min(1).max(500),
    classification: z.enum([
      'documentation',
      'source_code',
      'test',
      'configuration',
    ]),
  })
  .strict();

export const ProjectContextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().startsWith('project_'),
    sourceKind: z.literal('local_git'),
    repository: z
      .object({
        provider: z.literal('github'),
        owner: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
      })
      .strict()
      .optional(),
    revision: z.string().min(1).max(200),
    generatedAt: z.iso.datetime(),
    entries: z.array(ProjectContextEntrySchema).max(100),
    totalFiles: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    limits: z
      .object({
        maxFiles: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
        maxFileBytes: z.number().int().positive(),
      })
      .strict(),
    exclusions: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export const ProjectContextDocumentSchema = z
  .object({
    relativePath: z.string().min(1).max(1_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string(),
  })
  .strict();

export const ProjectContextBundleSchema = z
  .object({
    manifest: ProjectContextManifestSchema,
    documents: z.array(ProjectContextDocumentSchema).max(100),
  })
  .strict();

export type ProjectContextManifest = z.infer<
  typeof ProjectContextManifestSchema
>;
export type ProjectContextBundle = z.infer<typeof ProjectContextBundleSchema>;
