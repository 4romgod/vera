import { z } from 'zod';
import { ChangeApplicationFileSchema } from './software-change-application.ts';

const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);

export const SoftwareChangePublicationStatusSchema = z.enum([
  'awaiting_approval',
  'approved',
  'publishing',
  'succeeded',
  'rejected',
  'failed',
  'review_required',
  'cancelled',
]);

export const PublicationEffectSchema = z
  .object({
    adapterId: z.literal('github_gh_cli'),
    repository: z
      .object({
        remoteName: z.literal('origin'),
        owner: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
      })
      .strict(),
    baseRevision: GitRevisionSchema,
    baseBranch: z.string().min(1).max(200),
    baseBranchRevision: GitRevisionSchema,
    headBranch: z.string().startsWith('vera/change-').max(200),
    workspacePath: z.string().min(1).max(4_000),
    treeRevision: GitRevisionSchema,
    files: z.array(ChangeApplicationFileSchema).min(1).max(100),
    author: z
      .object({
        name: z.string().min(1).max(200),
        email: z.email().max(320),
      })
      .strict(),
    commitMessage: z.string().trim().min(1).max(5_000),
    pullRequest: z
      .object({
        title: z.string().trim().min(1).max(256),
        body: z.string().max(50_000),
        draft: z.boolean(),
      })
      .strict(),
    authority: z
      .object({
        commit: z.literal('create_one'),
        push: z.literal('create_or_verify_head'),
        pullRequest: z.literal('create_or_verify'),
        directBasePush: z.literal(false),
        forcePush: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const SoftwareChangePublicationEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: z.enum([
      'software_change_publication_created',
      'software_change_publication_approval_requested',
      'software_change_publication_approval_approved',
      'software_change_publication_approval_rejected',
      'software_change_publication_started',
      'software_change_publication_succeeded',
      'software_change_publication_failed',
      'software_change_publication_review_required',
      'software_change_publication_cancelled',
    ]),
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const SoftwareChangePublicationSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('publication_'),
    requestKey: z.string().min(1).max(200),
    principalId: z.string().min(1),
    status: SoftwareChangePublicationStatusSchema,
    sourceApplication: z
      .object({
        id: z.string().startsWith('application_'),
        effectId: z.string().startsWith('effect_'),
        version: z.number().int().positive(),
      })
      .strict(),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict(),
    approval: z
      .object({
        id: z.string().startsWith('approval_'),
        status: z.enum(['pending', 'approved', 'rejected']),
        reason: z.literal('software_change_publication'),
        effect: PublicationEffectSchema,
        requestedAt: z.iso.datetime(),
        decidedAt: z.iso.datetime().optional(),
        decidedBy: z.string().min(1).optional(),
      })
      .strict(),
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
        adapterId: z.literal('github_gh_cli'),
        commitRevision: GitRevisionSchema,
        remoteBranch: z.string().startsWith('vera/change-').max(200),
        pullRequest: z
          .object({
            number: z.number().int().positive(),
            url: z.url(),
            baseBranch: z.string().min(1).max(200),
            headBranch: z.string().min(1).max(200),
            draft: z.boolean(),
          })
          .strict(),
        publishedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    failure: z
      .object({
        code: z.enum([
          'publication_conflict',
          'publication_failed',
          'publication_unavailable',
          'review_required',
          'cancelled',
        ]),
        message: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    events: z.array(SoftwareChangePublicationEventSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const SoftwareChangePublicationJsonSchema = z.toJSONSchema(
  SoftwareChangePublicationSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);

export type PublicationEffect = z.infer<typeof PublicationEffectSchema>;
export type SoftwareChangePublication = z.infer<
  typeof SoftwareChangePublicationSchema
>;
export type SoftwareChangePublicationEvent = z.infer<
  typeof SoftwareChangePublicationEventSchema
>;
