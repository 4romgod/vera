import { z } from 'zod';

import { AttachmentReferenceSchema } from '../attachments/attachment.ts';

export const ClarificationInformationSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    description: z.string().trim().min(1).max(300),
  })
  .strict();

export const ClarificationFactSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    value: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const ClarificationRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    missingInformation: z
      .array(ClarificationInformationSchema)
      .min(1)
      .max(3)
      .refine(
        (items) => new Set(items.map(({ key }) => key)).size === items.length,
        'Clarification information keys must be unique.',
      ),
    resolvedFacts: z
      .array(ClarificationFactSchema)
      .max(12)
      .refine(
        (items) => new Set(items.map(({ key }) => key)).size === items.length,
        'Clarification fact keys must be unique.',
      ),
  })
  .strict()
  .superRefine((request, context) => {
    const missing = new Set(request.missingInformation.map(({ key }) => key));
    request.resolvedFacts.forEach((fact, index) => {
      if (missing.has(fact.key)) {
        context.addIssue({
          code: 'custom',
          path: ['resolvedFacts', index, 'key'],
          message: 'A fact cannot be both resolved and missing.',
        });
      }
    });
  });

const ClarificationAnswerSchema = z
  .object({
    messageId: z.string().startsWith('message_'),
    requestKey: z.string().min(1),
    content: z.string().trim().min(1).max(20_000),
    projectId: z.string().startsWith('project_').optional(),
    attachments: z.array(AttachmentReferenceSchema).max(5).optional(),
    answeredAt: z.iso.datetime(),
  })
  .strict();

export const IntentClarificationRoundSchema =
  ClarificationRequestSchema.safeExtend({
    id: z.string().startsWith('clarification_'),
    decisionId: z.string().startsWith('decision_'),
    askedAt: z.iso.datetime(),
    questionMessageId: z.string().startsWith('message_'),
    answer: ClarificationAnswerSchema.optional(),
  }).strict();

export const IntentClarificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum([
      'awaiting_answer',
      'evaluating_answer',
      'resolved',
      'stalled',
      'cancelled',
    ]),
    maxRounds: z.number().int().min(1).max(8),
    consecutiveNoProgressRounds: z.number().int().min(0).max(2),
    totalWaitingMs: z.number().int().min(0),
    rounds: z.array(IntentClarificationRoundSchema).min(1).max(8),
    resolvedAt: z.iso.datetime().optional(),
    stalledAt: z.iso.datetime().optional(),
    cancelledAt: z.iso.datetime().optional(),
  })
  .strict();

export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;
export type IntentClarification = z.infer<typeof IntentClarificationSchema>;
