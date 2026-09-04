import { z } from 'zod';

import { DevelopmentCampaignRepairSchema } from '../development-campaigns/development-campaign.ts';
export {
  SoftwareDeliveryManagementArgumentsSchema,
  SoftwareDeliveryRepairArgumentsSchema,
  SoftwareDeliveryActionArgumentsSchema,
  SoftwareDeliveryResourceReferenceSchema,
  type SoftwareDeliveryManagementArguments,
  type SoftwareDeliveryRepairArguments,
  type SoftwareDeliveryActionArguments,
} from './software-delivery-arguments.ts';

export const SoftwareDeliveryResourceKindSchema = z.enum([
  'mission',
  'development_campaign',
]);

export const SoftwareDeliveryMissionSummarySchema = z
  .object({
    kind: z.literal('mission'),
    id: z.string().startsWith('mission_'),
    status: z.enum([
      'awaiting_approval',
      'approved',
      'executing',
      'succeeded',
      'rejected',
      'review_required',
      'failed',
      'cancelled',
    ]),
    objective: z.string().trim().min(1).max(10_000),
    project: z.object({ id: z.string(), displayName: z.string() }).strict(),
    campaignId: z.string().startsWith('campaign_'),
    pullRequest: z
      .object({ number: z.number().int().positive(), url: z.url() })
      .strict()
      .optional(),
    failure: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const SoftwareDeliveryCampaignSummarySchema = z
  .object({
    kind: z.literal('development_campaign'),
    id: z.string().startsWith('campaign_'),
    status: z.enum([
      'awaiting_approval',
      'approved',
      'implementing',
      'applying',
      'verifying',
      'publishing',
      'observing',
      'repair_awaiting_approval',
      'repairing',
      'merging',
      'synchronizing',
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]),
    objective: z.string().trim().min(1).max(10_000),
    project: z.object({ id: z.string(), displayName: z.string() }).strict(),
    repository: z.object({ owner: z.string(), name: z.string() }).strict(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    repairAvailable: z.boolean(),
    pullRequest: z
      .object({
        number: z.number().int().positive(),
        url: z.url(),
        headRevision: z.string(),
        checks: z
          .object({
            pending: z.number().int().nonnegative(),
            passed: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        reviewDecision: z.string().optional(),
      })
      .strict()
      .optional(),
    failure: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const SoftwareDeliveryResourceSummarySchema = z.discriminatedUnion(
  'kind',
  [SoftwareDeliveryMissionSummarySchema, SoftwareDeliveryCampaignSummarySchema],
);

export const SoftwareDeliveryContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    resources: z.array(SoftwareDeliveryResourceSummarySchema).max(40),
  })
  .strict();

export const SoftwareDeliveryManagementResultSchema = z.discriminatedUnion(
  'action',
  [
    z
      .object({
        schemaVersion: z.literal(1),
        action: z.literal('list'),
        summary: z.string().trim().min(1).max(1_000),
        resources: z.array(SoftwareDeliveryResourceSummarySchema).max(40),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        action: z.literal('inspect'),
        summary: z.string().trim().min(1).max(1_000),
        resource: SoftwareDeliveryResourceSummarySchema,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        action: z.literal('prepare_repair'),
        summary: z.string().trim().min(1).max(1_000),
        campaign: SoftwareDeliveryCampaignSummarySchema,
        repair: DevelopmentCampaignRepairSchema,
      })
      .strict(),
  ],
);

export type SoftwareDeliveryManagementResult = z.infer<
  typeof SoftwareDeliveryManagementResultSchema
>;
export type SoftwareDeliveryContext = z.infer<
  typeof SoftwareDeliveryContextSchema
>;
export type SoftwareDeliveryResourceSummary = z.infer<
  typeof SoftwareDeliveryResourceSummarySchema
>;
