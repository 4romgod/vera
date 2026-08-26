import { z } from 'zod';

export const MemoryIdSchema = z.string().regex(/^memory_[a-z0-9][a-z0-9_-]*$/u);

export const MemoryKindSchema = z.enum([
  'fact',
  'preference',
  'instruction',
  'project_knowledge',
]);

export const MemorySensitivitySchema = z.enum(['personal', 'sensitive']);

export const MEMORY_HISTORY_LIMIT = 100;

export const MemoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z
    .object({
      kind: z.literal('project'),
      projectId: z.string().startsWith('project_'),
    })
    .strict(),
]);

export const MemoryProvenanceSchema = z
  .object({
    source: z.literal('owner_message'),
    taskId: z.string().startsWith('task_'),
    conversationId: z.string().startsWith('conversation_').optional(),
    messageId: z.string().startsWith('message_').optional(),
    invocationId: z.string().startsWith('invocation_'),
  })
  .strict();

export const MemoryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: MemoryIdSchema,
    revision: z.number().int().positive(),
    principalId: z.string().min(1),
    kind: MemoryKindSchema,
    subject: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(2_000),
    scope: MemoryScopeSchema,
    sensitivity: MemorySensitivitySchema,
    status: z.enum(['active', 'forgotten']),
    provenance: MemoryProvenanceSchema,
    creationInvocationId: z.string().startsWith('invocation_'),
    history: z
      .array(
        z
          .object({
            revision: z.number().int().positive(),
            kind: MemoryKindSchema,
            subject: z.string().trim().min(1).max(200),
            content: z.string().trim().min(1).max(2_000),
            scope: MemoryScopeSchema,
            sensitivity: MemorySensitivitySchema,
            provenance: MemoryProvenanceSchema,
            supersededAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(MEMORY_HISTORY_LIMIT),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    forgottenAt: z.iso.datetime().optional(),
    lastMutation: z
      .object({
        invocationId: z.string().startsWith('invocation_'),
        orderKey: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const MemoryResourceSchema = MemoryRecordSchema.omit({
  principalId: true,
  creationInvocationId: true,
  lastMutation: true,
});

const RememberMemoryArgumentsSchema = z
  .object({
    action: z.literal('remember'),
    kind: MemoryKindSchema,
    subject: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(2_000),
    scope: MemoryScopeSchema,
    sensitivity: MemorySensitivitySchema.optional(),
  })
  .strict();

const ListMemoriesArgumentsSchema = z
  .object({
    action: z.literal('list'),
    kind: MemoryKindSchema.optional(),
    scope: MemoryScopeSchema.optional(),
    status: z.enum(['active', 'all']).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const CorrectMemoryArgumentsSchema = z
  .object({
    action: z.literal('correct'),
    memoryId: MemoryIdSchema,
    kind: MemoryKindSchema.optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(2_000),
    scope: MemoryScopeSchema.optional(),
    sensitivity: MemorySensitivitySchema.optional(),
  })
  .strict();

const ForgetMemoryArgumentsSchema = z
  .object({
    action: z.literal('forget'),
    memoryId: MemoryIdSchema,
  })
  .strict();

export const MemoryActionArgumentsSchema = z.discriminatedUnion('action', [
  RememberMemoryArgumentsSchema,
  ListMemoriesArgumentsSchema,
  CorrectMemoryArgumentsSchema,
  ForgetMemoryArgumentsSchema,
]);

export const MemoryResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.enum(['remember', 'list', 'correct', 'forget']),
    summary: z.string().trim().min(1).max(1_000),
    memories: z.array(MemoryResourceSchema).max(100),
  })
  .strict();

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type MemoryResource = z.infer<typeof MemoryResourceSchema>;
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;
export type MemoryActionArguments = z.infer<typeof MemoryActionArgumentsSchema>;
export type MemoryResult = z.infer<typeof MemoryResultSchema>;

export function memoryResource(memory: MemoryRecord): MemoryResource {
  const {
    principalId: ignoredPrincipal,
    creationInvocationId: ignoredCreationInvocation,
    lastMutation: ignoredMutation,
    ...resource
  } = memory;
  void ignoredPrincipal;
  void ignoredCreationInvocation;
  void ignoredMutation;
  return MemoryResourceSchema.parse(resource);
}
