import { z } from 'zod';

const SoftwareChangeFileIdentitySchema = z
  .object({
    relativePath: z.string().min(1).max(1_000),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const SoftwareChangeFileSchema = z.discriminatedUnion('operation', [
  SoftwareChangeFileIdentitySchema.extend({
    operation: z.literal('create'),
    afterSha256: Sha256Schema,
  }).strict(),
  SoftwareChangeFileIdentitySchema.extend({
    operation: z.literal('update'),
    beforeSha256: Sha256Schema,
    afterSha256: Sha256Schema,
  }).strict(),
  SoftwareChangeFileIdentitySchema.extend({
    operation: z.literal('delete'),
    beforeSha256: Sha256Schema,
    bytes: z.literal(0),
  }).strict(),
]);

const SoftwareChangeVerificationSchema = z
  .object({
    command: z.string().trim().min(1).max(1_000),
    status: z.enum(['passed', 'failed', 'not_run']),
    details: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const SoftwareChangeReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: z.string().trim().min(1).max(2_000),
    verification: z.array(SoftwareChangeVerificationSchema).max(30),
    risks: z.array(z.string().trim().min(1).max(1_000)).max(20),
  })
  .strict();

export const SoftwareChangeSchema = SoftwareChangeReportSchema.extend({
  project: z
    .object({
      id: z.string().startsWith('project_'),
      name: z.string().trim().min(1).max(200),
      revision: z.string().min(1).max(200),
    })
    .strict(),
  ticket: z
    .object({
      reference: z.string().trim().min(1).max(200),
      details: z.string().trim().min(1).max(20_000),
    })
    .strict(),
  objective: z.string().trim().min(1).max(10_000),
  files: z.array(SoftwareChangeFileSchema).min(1).max(100),
  patch: z.string().startsWith('diff --git ').max(1_000_000),
}).strict();

export type SoftwareChangeReport = z.infer<typeof SoftwareChangeReportSchema>;
export type SoftwareChange = z.infer<typeof SoftwareChangeSchema>;

export const SoftwareChangeReportJsonSchema = z.toJSONSchema(
  SoftwareChangeReportSchema,
  { target: 'draft-7' },
);
