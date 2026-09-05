import { z } from 'zod';

import { ExternalSignalSchema } from './external-signal.ts';

export const ExternalSignalWorkflowStatusSchema = z.enum([
  'untriaged',
  'triaging',
  'action_approval_required',
  'repair_approval_required',
  'repairing',
  'verifying',
  'awaiting_source_confirmation',
  'triaged',
  'needs_attention',
  'resolved',
]);

export const ExternalSignalProgressSchema = z
  .object({
    status: ExternalSignalWorkflowStatusSchema,
    summary: z.string().trim().min(1).max(1_000),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ExternalSignalCampaignProgressSchema = z
  .object({
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
    pullRequest: z
      .object({
        number: z.number().int().positive(),
        url: z.url(),
      })
      .strict()
      .optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ExternalSignalResolutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    signal: ExternalSignalSchema,
    progress: ExternalSignalProgressSchema,
    task: z
      .object({
        id: z.string().startsWith('task_'),
        runId: z.string().startsWith('run_'),
        runStatus: z.enum([
          'deciding',
          'awaiting_approval',
          'executing',
          'succeeded',
          'rejected',
          'failed',
          'cancellation_requested',
          'cancelled',
        ]),
        conversationId: z.string().startsWith('conversation_').optional(),
      })
      .strict()
      .optional(),
    campaign: ExternalSignalCampaignProgressSchema.optional(),
    links: z
      .object({
        signal: z.string().startsWith('/v1/external-signals/'),
        source: z.url(),
        task: z.string().startsWith('/v1/tasks/').optional(),
        run: z.string().startsWith('/v1/runs/').optional(),
        conversation: z.string().startsWith('/v1/conversations/').optional(),
        campaign: z
          .string()
          .startsWith('/v1/development-campaigns/')
          .optional(),
      })
      .strict(),
  })
  .strict();

export type ExternalSignalProgress = z.infer<
  typeof ExternalSignalProgressSchema
>;
export type ExternalSignalResolution = z.infer<
  typeof ExternalSignalResolutionSchema
>;

export const ExternalSignalResolutionJsonSchema = z.toJSONSchema(
  ExternalSignalResolutionSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);
