import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

const WorkingTreeRelativePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !containsControlCharacter(value) &&
      value
        .split('/')
        .every(
          (segment) =>
            segment.length > 0 && segment !== '.' && segment !== '..',
        ),
    'Working-tree paths must be safe repository-relative paths.',
  );

const WorkingTreeFileIdentitySchema = z
  .object({
    relativePath: WorkingTreeRelativePathSchema,
    bytes: z.number().int().nonnegative(),
    staged: z.boolean(),
    unstaged: z.boolean(),
    untracked: z.boolean(),
  })
  .strict();

export const WorkingTreeFileSchema = z.discriminatedUnion('operation', [
  WorkingTreeFileIdentitySchema.extend({
    operation: z.literal('create'),
    afterSha256: Sha256Schema,
  }).strict(),
  WorkingTreeFileIdentitySchema.extend({
    operation: z.literal('update'),
    beforeSha256: Sha256Schema,
    afterSha256: Sha256Schema,
  }).strict(),
  WorkingTreeFileIdentitySchema.extend({
    operation: z.literal('delete'),
    beforeSha256: Sha256Schema,
    bytes: z.literal(0),
  }).strict(),
]);

export const WorkingTreeSnapshotReferenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseRevision: GitRevisionSchema,
    snapshotSha256: Sha256Schema,
    patchSha256: Sha256Schema,
    files: z.array(WorkingTreeFileSchema).min(1).max(100),
    totalFiles: z.number().int().min(1).max(100),
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();

export const WorkingTreeSnapshotSchema =
  WorkingTreeSnapshotReferenceSchema.extend({
    patch: z.string().startsWith('diff --git ').max(1_000_000),
    capturedAt: z.iso.datetime(),
  }).strict();

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
    workingTree: WorkingTreeSnapshotSchema.optional(),
  })
  .strict();

export type ProjectContextManifest = z.infer<
  typeof ProjectContextManifestSchema
>;
export type ProjectContextBundle = z.infer<typeof ProjectContextBundleSchema>;
export type WorkingTreeFile = z.infer<typeof WorkingTreeFileSchema>;
export type WorkingTreeSnapshot = z.infer<typeof WorkingTreeSnapshotSchema>;
export type WorkingTreeSnapshotReference = z.infer<
  typeof WorkingTreeSnapshotReferenceSchema
>;

export function workingTreeSnapshotHashPayload(input: {
  baseRevision: string;
  patchSha256: string;
  files: WorkingTreeFile[];
}) {
  return {
    baseRevision: input.baseRevision,
    patchSha256: input.patchSha256,
    files: input.files.map((file) => WorkingTreeFileSchema.parse(file)),
  };
}

export function workingTreeSnapshotReference(
  snapshot: WorkingTreeSnapshot,
): WorkingTreeSnapshotReference {
  return WorkingTreeSnapshotReferenceSchema.parse({
    schemaVersion: snapshot.schemaVersion,
    baseRevision: snapshot.baseRevision,
    snapshotSha256: snapshot.snapshotSha256,
    patchSha256: snapshot.patchSha256,
    files: snapshot.files,
    totalFiles: snapshot.totalFiles,
    totalBytes: snapshot.totalBytes,
  });
}

export function sameWorkingTreeSnapshotReference(
  left: WorkingTreeSnapshotReference | undefined,
  right: WorkingTreeSnapshotReference | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
