import { z } from 'zod';

const ConversationContextLimitsSchema = z
  .object({
    maxMessages: z.number().int().min(2).max(100).multipleOf(2),
    maxCharacters: z.number().int().min(1_000).max(1_000_000),
  })
  .strict();

const ConversationContextScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unscoped') }).strict(),
  z
    .object({
      kind: z.literal('project'),
      projectId: z.string().startsWith('project_'),
    })
    .strict(),
]);

const ConversationContextEntrySchema = z
  .object({
    messageId: z.string().startsWith('message_'),
    taskId: z.string().startsWith('task_'),
    role: z.enum(['owner', 'vera']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    characters: z.number().int().nonnegative(),
  })
  .strict();

export const ConversationContextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversationId: z.string().startsWith('conversation_'),
    throughMessageId: z.string().startsWith('message_'),
    scope: ConversationContextScopeSchema,
    entries: z.array(ConversationContextEntrySchema),
    totalMessages: z.number().int().nonnegative(),
    totalCharacters: z.number().int().nonnegative(),
    limits: ConversationContextLimitsSchema,
    exclusions: z
      .object({
        differentScope: z.number().int().nonnegative(),
        incompleteTurns: z.number().int().nonnegative(),
        limits: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const ConversationContextMessageSchema = z
  .object({
    messageId: z.string().startsWith('message_'),
    taskId: z.string().startsWith('task_'),
    role: z.enum(['owner', 'vera']),
    content: z.string().min(1).max(20_000),
  })
  .strict();

export const ConversationContextBundleSchema = z
  .object({
    manifest: ConversationContextManifestSchema,
    messages: z.array(ConversationContextMessageSchema),
  })
  .strict();

export type ConversationContextLimits = z.infer<
  typeof ConversationContextLimitsSchema
>;
export type ConversationContextManifest = z.infer<
  typeof ConversationContextManifestSchema
>;
export type ConversationContextBundle = z.infer<
  typeof ConversationContextBundleSchema
>;
