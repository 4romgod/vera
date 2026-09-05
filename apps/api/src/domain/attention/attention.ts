import { z } from 'zod';

export const AttentionPrioritySchema = z.enum(['urgent', 'high', 'normal']);
export const AttentionStateSchema = z.enum(['active', 'snoozed', 'dismissed']);

export const AttentionTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('task'),
      taskId: z.string().startsWith('task_'),
      runId: z.string().startsWith('run_'),
      conversationId: z.string().startsWith('conversation_').optional(),
      approvalId: z.string().startsWith('approval_').optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('personal_task'),
      personalTaskId: z.string().startsWith('personal_task_'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('reminder'),
      reminderId: z.string().startsWith('reminder_'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mission'),
      missionId: z.string().startsWith('mission_'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('campaign'),
      campaignId: z.string().startsWith('campaign_'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('routine'),
      routineId: z.string().startsWith('routine_'),
      routineRunId: z.string().startsWith('routine_run_').optional(),
      approvalId: z.string().startsWith('approval_').optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('external_signal'),
      externalSignalId: z.string().startsWith('external_signal_'),
      routineId: z.string().startsWith('routine_'),
      url: z.url(),
    })
    .strict(),
]);

export const AttentionItemSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('attention_'),
    reason: z.enum([
      'approval_required',
      'run_failed',
      'task_overdue',
      'task_due_soon',
      'open_task',
      'reminder_delivered',
      'reminder_due_soon',
      'mission_review_required',
      'mission_failed',
      'mission_result_ready',
      'campaign_review_required',
      'campaign_failed',
      'campaign_result_ready',
      'routine_approval_required',
      'routine_check_failed',
      'routine_attention_required',
      'external_review_requested',
      'external_mentioned',
      'external_assigned',
      'external_check_failed',
    ]),
    priority: AttentionPrioritySchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000),
    occurredAt: z.iso.datetime(),
    target: AttentionTargetSchema,
    state: AttentionStateSchema,
    snoozedUntil: z.iso.datetime().optional(),
  })
  .strict();

export const AttentionCountsSchema = z
  .object({
    urgent: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    normal: z.number().int().nonnegative(),
    snoozed: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
  })
  .strict();

export const AttentionBriefingSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    headline: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000),
    counts: AttentionCountsSchema,
    items: z.array(AttentionItemSchema).max(500),
    snoozedItems: z.array(AttentionItemSchema).max(500),
    dismissedItems: z.array(AttentionItemSchema).max(500),
  })
  .strict();

export const AttentionDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('attention_decision_'),
    principalId: z.string().min(1),
    requestKey: z.string().min(1).max(200),
    attentionItemId: z.string().startsWith('attention_'),
    decision: z.enum(['dismissed', 'snoozed', 'restored']),
    snoozedUntil: z.iso.datetime().optional(),
    decidedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      (decision.decision === 'snoozed') !==
      (decision.snoozedUntil !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snoozedUntil'],
        message: 'Only a snooze decision requires snoozedUntil.',
      });
    }
  });

export const AttentionDecisionRequestSchema = z
  .object({
    decision: z.enum(['dismiss', 'snooze', 'restore']),
    snoozedUntil: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      (request.decision === 'snooze') !==
      (request.snoozedUntil !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snoozedUntil'],
        message: 'Only snooze requires snoozedUntil.',
      });
    }
  });

export const AttentionActionArgumentsSchema = z
  .object({ action: z.literal('brief') })
  .strict();

export const AttentionResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('brief'),
    summary: z.string().trim().min(1).max(2_000),
    briefing: AttentionBriefingSchema,
  })
  .strict();

export type AttentionItem = z.infer<typeof AttentionItemSchema>;
export type AttentionBriefing = z.infer<typeof AttentionBriefingSchema>;
export type AttentionDecision = z.infer<typeof AttentionDecisionSchema>;
export type AttentionDecisionRequest = z.infer<
  typeof AttentionDecisionRequestSchema
>;
export type AttentionResult = z.infer<typeof AttentionResultSchema>;

export const AttentionDecisionJsonSchema = z.toJSONSchema(
  AttentionDecisionSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);
