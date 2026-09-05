import { z } from 'zod';

export const LiveVoiceSessionLimits = {
  maxTurns: 100,
  maxDeliveries: 300,
} as const;

const VoiceTurnSchema = z
  .object({
    id: z.string().startsWith('voice_turn_'),
    sequence: z.number().int().positive(),
    status: z.enum([
      'transcribing',
      'submitted',
      'awaiting_approval',
      'settled',
      'failed',
    ]),
    transcript: z.string().trim().min(1).max(20_000).optional(),
    messageId: z.string().startsWith('message_').optional(),
    taskId: z.string().startsWith('task_').optional(),
    runId: z.string().startsWith('run_').optional(),
    failure: z.string().trim().min(1).max(2_000).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const SpeechDeliverySchema = z
  .object({
    id: z.string().startsWith('speech_delivery_'),
    turnId: z.string().startsWith('voice_turn_'),
    kind: z.enum(['approval', 'response', 'failure']),
    state: z.enum([
      'prepared',
      'released',
      'played',
      'interrupted',
      'delivery_unknown',
    ]),
    content: z.string().trim().min(1).max(20_000),
    messageId: z.string().startsWith('message_').optional(),
    preparedAt: z.iso.datetime(),
    releasedAt: z.iso.datetime().optional(),
    settledAt: z.iso.datetime().optional(),
  })
  .strict();

export const LiveVoiceSessionObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('voice_session_'),
    principalId: z.string().min(1),
    requestKey: z.string().min(1).max(200),
    takeoverRequested: z.boolean(),
    activeSlot: z.literal(1).optional(),
    conversationId: z.string().startsWith('conversation_'),
    projectId: z.string().startsWith('project_').optional(),
    roomName: z.string().startsWith('vera_voice_').max(200),
    participantIdentity: z.string().startsWith('vera_owner_').max(200),
    status: z.enum(['starting', 'active', 'reconnecting', 'ended', 'failed']),
    expiresAt: z.iso.datetime(),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    connectedAt: z.iso.datetime().optional(),
    endedAt: z.iso.datetime().optional(),
    failure: z.string().trim().min(1).max(2_000).optional(),
    turns: z.array(VoiceTurnSchema).max(LiveVoiceSessionLimits.maxTurns),
    deliveries: z
      .array(SpeechDeliverySchema)
      .max(LiveVoiceSessionLimits.maxDeliveries),
  })
  .strict();

export const LiveVoiceSessionSchema = LiveVoiceSessionObjectSchema.superRefine(
  (session, context) => {
    const active = ['starting', 'active', 'reconnecting'].includes(
      session.status,
    );
    if (active !== (session.activeSlot === 1)) {
      context.addIssue({
        code: 'custom',
        path: ['activeSlot'],
        message: 'activeSlot must exist exactly while the session is active',
      });
    }
    if (active === (session.endedAt !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'endedAt must exist exactly after the session is terminal',
      });
    }
    if (session.expiresAt <= session.startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be after startedAt',
      });
    }
    const turnIds = new Set<string>();
    for (const [index, turn] of session.turns.entries()) {
      if (turn.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'sequence'],
          message: 'voice turn sequences must be contiguous',
        });
      }
      if (turnIds.has(turn.id)) {
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'id'],
          message: 'voice turn IDs must be unique',
        });
      }
      turnIds.add(turn.id);
      if (
        ['submitted', 'awaiting_approval', 'settled'].includes(turn.status) &&
        (turn.transcript === undefined ||
          turn.messageId === undefined ||
          turn.taskId === undefined ||
          turn.runId === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['turns', index],
          message: 'submitted voice turns require durable task identities',
        });
      }
    }
    const deliveryIds = new Set<string>();
    for (const [index, delivery] of session.deliveries.entries()) {
      if (deliveryIds.has(delivery.id)) {
        context.addIssue({
          code: 'custom',
          path: ['deliveries', index, 'id'],
          message: 'speech delivery IDs must be unique',
        });
      }
      deliveryIds.add(delivery.id);
      if (!turnIds.has(delivery.turnId)) {
        context.addIssue({
          code: 'custom',
          path: ['deliveries', index, 'turnId'],
          message: 'speech deliveries must reference a session turn',
        });
      }
      const released = delivery.state !== 'prepared';
      const settled = !['prepared', 'released'].includes(delivery.state);
      if (released !== (delivery.releasedAt !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['deliveries', index, 'releasedAt'],
          message: 'releasedAt must exist after speech is released',
        });
      }
      if (settled !== (delivery.settledAt !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['deliveries', index, 'settledAt'],
          message: 'settledAt must exist exactly after delivery settles',
        });
      }
    }
  },
);

export type LiveVoiceSession = z.infer<typeof LiveVoiceSessionSchema>;
export type VoiceTurn = z.infer<typeof VoiceTurnSchema>;
export type SpeechDelivery = z.infer<typeof SpeechDeliverySchema>;

export const LiveVoiceSessionJsonSchema = z.toJSONSchema(
  LiveVoiceSessionSchema,
  { target: 'draft-7' },
);
