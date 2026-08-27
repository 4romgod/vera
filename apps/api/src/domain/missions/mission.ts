import { z } from 'zod';

import { DevelopmentCampaignEffectSchema } from '../development-campaigns/development-campaign.ts';
import { MissionNotificationResourceSchema } from '../notifications/notification.ts';
import { MissionProposalArgumentsSchema } from './mission-proposal.ts';
export {
  MissionProposalArgumentsSchema,
  type MissionProposalArguments,
} from './mission-proposal.ts';

const SafeIdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/u)
  .max(100);

export const MissionCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    policies: z
      .array(
        z
          .object({
            id: SafeIdentifierSchema,
            campaignPolicyId: SafeIdentifierSchema,
            limits: z
              .object({
                maxCampaigns: z.literal(1),
                maxDurationMinutes: z
                  .number()
                  .int()
                  .min(5)
                  .max(24 * 60),
              })
              .strict(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    catalog.policies.forEach((policy, index) => {
      if (ids.has(policy.id)) {
        context.addIssue({
          code: 'custom',
          path: ['policies', index, 'id'],
          message: `Mission policy ID ${policy.id} is duplicated.`,
        });
      }
      ids.add(policy.id);
    });
  });

export const MissionPolicySummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SafeIdentifierSchema,
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict(),
    campaignPolicyId: SafeIdentifierSchema,
    limits: z
      .object({
        maxCampaigns: z.literal(1),
        maxDurationMinutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60),
      })
      .strict(),
    authority: z
      .object({
        selectOneOutcome: z.literal(true),
        createDevelopmentCampaigns: z.literal(1),
        createPullRequest: z.literal(true),
        mergePullRequest: z.literal(false),
        recurringExecution: z.literal(false),
        missionPolicyMutation: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const MissionEffectSchema = z
  .object({
    policyId: SafeIdentifierSchema,
    objective: MissionProposalArgumentsSchema.shape.objective,
    completionCriteria: MissionProposalArgumentsSchema.shape.completionCriteria,
    project: MissionPolicySummarySchema.shape.project,
    limits: MissionPolicySummarySchema.shape.limits,
    campaign: z
      .object({
        id: z.string().startsWith('campaign_'),
        approvalId: z.string().startsWith('approval_'),
        effect: DevelopmentCampaignEffectSchema,
      })
      .strict(),
    authority: MissionPolicySummarySchema.shape.authority,
  })
  .strict();

export const MissionStatusSchema = z.enum([
  'awaiting_approval',
  'approved',
  'executing',
  'succeeded',
  'rejected',
  'review_required',
  'failed',
  'cancelled',
]);

export const MissionEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('event_'),
    sequence: z.number().int().positive(),
    type: z.enum([
      'mission_created',
      'mission_approval_requested',
      'mission_approval_approved',
      'mission_approval_rejected',
      'mission_campaign_delegated',
      'mission_progress_observed',
      'mission_succeeded',
      'mission_review_required',
      'mission_failed',
      'mission_cancelled',
      'mission_notification_delivered',
    ]),
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const MissionSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('mission_'),
    requestKey: z.string().min(1).max(200),
    principalId: z.string().min(1),
    status: MissionStatusSchema,
    source: z
      .object({
        taskId: z.string().startsWith('task_'),
        conversationId: z.string().startsWith('conversation_').optional(),
        messageId: z.string().startsWith('message_').optional(),
      })
      .strict()
      .optional(),
    approval: z
      .object({
        id: z.string().startsWith('approval_'),
        status: z.enum(['pending', 'approved', 'rejected']),
        reason: z.literal('bounded_mission'),
        effect: MissionEffectSchema,
        requestedAt: z.iso.datetime(),
        decidedAt: z.iso.datetime().optional(),
        decidedBy: z.string().min(1).optional(),
      })
      .strict(),
    result: z
      .object({
        outcome: z.literal('pull_request_ready'),
        campaignId: z.string().startsWith('campaign_'),
        pullRequestNumber: z.number().int().positive(),
        pullRequestUrl: z.url(),
        completedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    failure: z
      .object({
        code: z.enum([
          'mission_expired',
          'campaign_review_required',
          'campaign_failed',
          'campaign_cancelled',
          'mission_conflict',
          'cancelled',
        ]),
        message: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    notification: MissionNotificationResourceSchema.optional(),
    events: z.array(MissionEventSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const MissionJsonSchema = z.toJSONSchema(MissionSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});

export const MissionManagementResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('create'),
    summary: z.string().trim().min(1).max(1_000),
    mission: z
      .object({
        id: z.string().startsWith('mission_'),
        status: z.literal('awaiting_approval'),
        objective: z.string().trim().min(1).max(10_000),
      })
      .strict(),
  })
  .strict();

export type Mission = z.infer<typeof MissionSchema>;
export type MissionEvent = z.infer<typeof MissionEventSchema>;
export type MissionCatalog = z.infer<typeof MissionCatalogSchema>;
export type MissionPolicySummary = z.infer<typeof MissionPolicySummarySchema>;
export type MissionManagementResult = z.infer<
  typeof MissionManagementResultSchema
>;
