import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ChangeApplicationStatusSchema = z.enum([
  'awaiting_approval',
  'approved',
  'applying',
  'succeeded',
  'rejected',
  'failed',
  'review_required',
  'cancellation_requested',
  'cancelled',
]);

const ChangeApplicationFileSchema = z.discriminatedUnion('operation', [
  z
    .object({
      relativePath: z.string().min(1).max(1_000),
      operation: z.literal('create'),
      afterSha256: Sha256Schema,
      bytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      relativePath: z.string().min(1).max(1_000),
      operation: z.literal('update'),
      beforeSha256: Sha256Schema,
      afterSha256: Sha256Schema,
      bytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      relativePath: z.string().min(1).max(1_000),
      operation: z.literal('delete'),
      beforeSha256: Sha256Schema,
      bytes: z.literal(0),
    })
    .strict(),
]);

export const ChangeApplicationApprovalSchema = z
  .object({
    id: z.string().startsWith('approval_'),
    status: z.enum(['pending', 'approved', 'rejected']),
    reason: z.literal('software_change_application'),
    sourceArtifact: z
      .object({
        id: z.string().startsWith('artifact_'),
        sha256: Sha256Schema,
      })
      .strict(),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict(),
    effect: z
      .object({
        adapterId: z.literal('local_git_worktree'),
        baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/u),
        branchName: z.string().min(1).max(200),
        workspacePath: z.string().min(1).max(4_000),
        patchSha256: Sha256Schema,
        staged: z.literal(true),
        files: z.array(ChangeApplicationFileSchema).min(1).max(100),
      })
      .strict(),
    requestedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().optional(),
    decidedBy: z.string().min(1).optional(),
  })
  .strict();

export const ChangeApplicationEventTypeSchema = z.enum([
  'change_application_created',
  'change_application_approval_requested',
  'change_application_approval_approved',
  'change_application_approval_rejected',
  'change_application_started',
  'change_application_succeeded',
  'change_application_failed',
  'change_application_review_required',
  'change_application_cancellation_requested',
  'change_application_cancelled',
]);

export const ChangeApplicationEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: ChangeApplicationEventTypeSchema,
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const SoftwareChangeApplicationSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('application_'),
    requestKey: z.string().min(1).max(200),
    principalId: z.string().min(1),
    status: ChangeApplicationStatusSchema,
    sourceArtifact: z
      .object({
        id: z.string().startsWith('artifact_'),
        sha256: Sha256Schema,
      })
      .strict(),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict(),
    approval: ChangeApplicationApprovalSchema,
    effect: z
      .object({
        id: z.string().startsWith('effect_'),
        status: z.enum([
          'pending',
          'executing',
          'succeeded',
          'failed',
          'review_required',
          'cancelled',
        ]),
        startedAt: z.iso.datetime().optional(),
        completedAt: z.iso.datetime().optional(),
      })
      .strict(),
    result: z
      .object({
        adapterId: z.literal('local_git_worktree'),
        baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/u),
        branchName: z.string().min(1).max(200),
        workspacePath: z.string().min(1).max(4_000),
        patchSha256: Sha256Schema,
        staged: z.literal(true),
        files: z.array(ChangeApplicationFileSchema).min(1).max(100),
        appliedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    failure: z
      .object({
        code: z.enum([
          'stale_source',
          'application_conflict',
          'application_failed',
          'review_required',
          'cancelled',
        ]),
        message: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    events: z.array(ChangeApplicationEventSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const SoftwareChangeApplicationJsonSchema = z.toJSONSchema(
  SoftwareChangeApplicationSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);

export type SoftwareChangeApplication = z.infer<
  typeof SoftwareChangeApplicationSchema
>;
export type ChangeApplicationEvent = z.infer<
  typeof ChangeApplicationEventSchema
>;
export type ChangeApplicationFile = z.infer<typeof ChangeApplicationFileSchema>;
