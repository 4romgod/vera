import { z } from 'zod';

import { CapabilityAuthoritySchema } from '../capabilities/capability-registry.ts';
import { CapabilityDestinationSchema } from '../capabilities/capability-destination.ts';

const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);
const SafeIdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/u)
  .max(100);

const DevelopmentCampaignLimitsSchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(3),
    maxChangedFiles: z.number().int().min(1).max(100),
    maxChangedBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    maxDurationMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    minimumRequiredChecks: z.number().int().min(1).max(20),
  })
  .strict();

const DevelopmentCampaignMergePolicySchema = z
  .object({
    method: z.enum(['squash', 'merge', 'rebase']),
    requireReviewApproval: z.boolean(),
    synchronizeLocalBase: z.boolean(),
  })
  .strict();

export const DevelopmentCampaignCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    policies: z
      .array(
        z
          .object({
            id: SafeIdentifierSchema,
            projectRoot: z.string().min(1).max(4_000),
            baseBranch: z.string().min(1).max(200),
            qualityGates: z
              .array(
                z
                  .object({
                    id: SafeIdentifierSchema,
                    label: z.string().trim().min(1).max(200),
                    executable: z.string().min(1).max(4_000),
                    arguments: z.array(z.string().max(2_000)).max(50),
                    timeoutMs: z
                      .number()
                      .int()
                      .min(1_000)
                      .max(30 * 60_000),
                  })
                  .strict(),
              )
              .min(1)
              .max(10),
            protectedPathPrefixes: z
              .array(z.string().min(1).max(1_000))
              .max(100),
            limits: DevelopmentCampaignLimitsSchema,
            merge: DevelopmentCampaignMergePolicySchema,
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((catalog, context) => {
    const identities = new Set<string>();
    catalog.policies.forEach((policy, index) => {
      if (identities.has(policy.id)) {
        context.addIssue({
          code: 'custom',
          message: `Development campaign policy ID ${policy.id} is duplicated.`,
          path: ['policies', index, 'id'],
        });
      }
      identities.add(policy.id);
    });
  });

export const DevelopmentCampaignPolicySummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SafeIdentifierSchema,
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict(),
    baseBranch: z.string().min(1).max(200),
    qualityGates: z
      .array(
        z
          .object({
            id: SafeIdentifierSchema,
            label: z.string().min(1).max(200),
            timeoutMs: z
              .number()
              .int()
              .min(1_000)
              .max(30 * 60_000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    limits: DevelopmentCampaignLimitsSchema,
    merge: DevelopmentCampaignMergePolicySchema,
  })
  .strict();

export const DevelopmentCampaignStatusSchema = z.enum([
  'awaiting_approval',
  'approved',
  'implementing',
  'applying',
  'verifying',
  'publishing',
  'observing',
  'merging',
  'synchronizing',
  'succeeded',
  'rejected',
  'failed',
  'review_required',
  'cancelled',
]);

const CampaignCapabilitySchema = z
  .object({
    name: z.enum(['development_planning', 'software_change']),
    version: z.literal(1),
    destination: CapabilityDestinationSchema,
    authority: CapabilityAuthoritySchema,
  })
  .strict();

const CampaignQualityGateSchema = z
  .object({
    id: SafeIdentifierSchema,
    label: z.string().min(1).max(200),
    executable: z.string().min(1).max(4_000),
    arguments: z.array(z.string().max(2_000)).max(50),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(30 * 60_000),
  })
  .strict();

export const DevelopmentCampaignEffectSchema = z
  .object({
    adapterId: z.literal('local_git_github'),
    policyId: SafeIdentifierSchema,
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict(),
    repository: z
      .object({
        owner: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
      })
      .strict(),
    baseBranch: z.string().min(1).max(200),
    baseRevision: GitRevisionSchema,
    objective: z.string().trim().min(1).max(10_000),
    ticket: z
      .object({
        reference: z.string().trim().min(1).max(200),
        details: z.string().trim().min(1).max(20_000),
      })
      .strict(),
    delivery: z
      .object({
        commitMessage: z.string().trim().min(1).max(5_000),
        pullRequest: z
          .object({
            title: z.string().trim().min(1).max(256),
            body: z.string().max(50_000),
            draft: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    capabilities: z.array(CampaignCapabilitySchema).min(1).max(2),
    qualityGates: z.array(CampaignQualityGateSchema).min(1).max(10),
    protectedPathPrefixes: z.array(z.string().min(1).max(1_000)).max(100),
    limits: z
      .object({
        maxAttempts: z.number().int().min(1).max(3),
        maxChangedFiles: z.number().int().min(1).max(100),
        maxChangedBytes: z.number().int().positive(),
        maxDurationMinutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60),
        minimumRequiredChecks: z.number().int().min(1).max(20),
      })
      .strict(),
    merge: z
      .object({
        method: z.enum(['squash', 'merge', 'rebase']),
        requireReviewApproval: z.boolean(),
        synchronizeLocalBase: z.boolean(),
      })
      .strict(),
    authority: z
      .object({
        implementation: z.literal('bounded_capabilities'),
        application: z.literal('exact_generated_patch'),
        verification: z.literal('configured_commands'),
        publication: z.literal('create_one_pull_request'),
        observation: z.literal('github_checks_and_reviews'),
        merge: z.literal('policy_gated_exact_head'),
        directBasePush: z.literal(false),
        forcePush: z.literal(false),
        policyMutation: z.literal(false),
      })
      .strict(),
  })
  .strict();

const GateResultSchema = z
  .object({
    id: SafeIdentifierSchema,
    label: z.string().min(1).max(200),
    status: z.enum(['passed', 'failed']),
    exitCode: z.number().int(),
    durationMs: z.number().nonnegative(),
    output: z.string().max(8_000),
  })
  .strict();

const CampaignAttemptSchema = z
  .object({
    number: z.number().int().positive().max(3),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    artifactId: z.string().startsWith('artifact_').optional(),
    applicationId: z.string().startsWith('application_').optional(),
    verification: z
      .object({
        status: z.enum(['passed', 'failed']),
        checkedAt: z.iso.datetime(),
        gates: z.array(GateResultSchema).min(1).max(10),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PullRequestObservationSchema = z
  .object({
    checkedAt: z.iso.datetime(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    headRevision: GitRevisionSchema,
    baseRevision: GitRevisionSchema,
    checks: z
      .object({
        total: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    reviewDecision: z.enum([
      'APPROVED',
      'CHANGES_REQUESTED',
      'REVIEW_REQUIRED',
      'NONE',
    ]),
    mergeState: z.string().min(1).max(100),
  })
  .strict();

export const DevelopmentCampaignEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: z.enum([
      'development_campaign_created',
      'development_campaign_approval_requested',
      'development_campaign_approval_approved',
      'development_campaign_approval_rejected',
      'development_campaign_attempt_started',
      'development_campaign_task_approval_delegated',
      'development_campaign_change_produced',
      'development_campaign_change_applied',
      'development_campaign_verification_passed',
      'development_campaign_verification_failed',
      'development_campaign_repair_started',
      'development_campaign_publication_started',
      'development_campaign_pull_request_created',
      'development_campaign_pull_request_observed',
      'development_campaign_merge_started',
      'development_campaign_merged',
      'development_campaign_synchronized',
      'development_campaign_succeeded',
      'development_campaign_failed',
      'development_campaign_review_required',
      'development_campaign_cancelled',
    ]),
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const DevelopmentCampaignSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('campaign_'),
    requestKey: z.string().min(1).max(200),
    principalId: z.string().min(1),
    status: DevelopmentCampaignStatusSchema,
    approval: z
      .object({
        id: z.string().startsWith('approval_'),
        status: z.enum(['pending', 'approved', 'rejected']),
        reason: z.literal('development_campaign'),
        effect: DevelopmentCampaignEffectSchema,
        requestedAt: z.iso.datetime(),
        decidedAt: z.iso.datetime().optional(),
        decidedBy: z.string().min(1).optional(),
      })
      .strict(),
    attempts: z.array(CampaignAttemptSchema).max(3),
    publicationId: z.string().startsWith('publication_').optional(),
    pullRequest: z
      .object({
        number: z.number().int().positive(),
        url: z.url(),
        headRevision: GitRevisionSchema,
        observation: PullRequestObservationSchema.optional(),
      })
      .strict()
      .optional(),
    mergeResult: z
      .object({
        mergeRevision: GitRevisionSchema,
        baseRevision: GitRevisionSchema,
        mergedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    result: z
      .object({
        pullRequestNumber: z.number().int().positive(),
        pullRequestUrl: z.url(),
        mergeRevision: GitRevisionSchema,
        baseRevision: GitRevisionSchema,
        attempts: z.number().int().positive().max(3),
        completedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    failure: z
      .object({
        code: z.enum([
          'campaign_expired',
          'campaign_conflict',
          'implementation_failed',
          'verification_failed',
          'publication_failed',
          'checks_failed',
          'review_required',
          'merge_failed',
          'synchronization_failed',
          'cancelled',
        ]),
        message: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    events: z.array(DevelopmentCampaignEventSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const DevelopmentCampaignJsonSchema = z.toJSONSchema(
  DevelopmentCampaignSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);

export type DevelopmentCampaignCatalog = z.infer<
  typeof DevelopmentCampaignCatalogSchema
>;
export type DevelopmentCampaignPolicySummary = z.infer<
  typeof DevelopmentCampaignPolicySummarySchema
>;
export type DevelopmentCampaignEffect = z.infer<
  typeof DevelopmentCampaignEffectSchema
>;
export type DevelopmentCampaign = z.infer<typeof DevelopmentCampaignSchema>;
export type DevelopmentCampaignEvent = z.infer<
  typeof DevelopmentCampaignEventSchema
>;
export type PullRequestObservation = z.infer<
  typeof PullRequestObservationSchema
>;
