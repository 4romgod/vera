import { z } from 'zod';

import {
  MemoryIdSchema,
  MemoryKindSchema,
  MemoryScopeSchema,
  MemorySensitivitySchema,
} from './memory.ts';

export const MemoryContextLimitsSchema = z
  .object({
    maxMemories: z.number().int().positive().max(100),
    maxCharacters: z.number().int().positive().max(100_000),
  })
  .strict();

export const MemoryContextEntrySchema = z
  .object({
    memoryId: MemoryIdSchema,
    revision: z.number().int().positive(),
    kind: MemoryKindSchema,
    subject: z.string().min(1).max(200),
    content: z.string().min(1).max(2_000),
    scope: MemoryScopeSchema,
    sensitivity: MemorySensitivitySchema,
    updatedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    characters: z.number().int().positive(),
  })
  .strict();

export const MemoryContextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    principalId: z.string().min(1),
    projectId: z.string().startsWith('project_').optional(),
    assembledAt: z.iso.datetime(),
    entries: z.array(
      MemoryContextEntrySchema.pick({
        memoryId: true,
        revision: true,
        sha256: true,
        characters: true,
      }),
    ),
    totalMemories: z.number().int().nonnegative(),
    totalCharacters: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    limits: MemoryContextLimitsSchema,
    exclusions: z
      .object({
        differentScope: z.number().int().nonnegative(),
        limits: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const MemoryContextBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    memories: z.array(MemoryContextEntrySchema),
    manifest: MemoryContextManifestSchema,
  })
  .strict();

export type MemoryContextLimits = z.infer<typeof MemoryContextLimitsSchema>;
export type MemoryContextBundle = z.infer<typeof MemoryContextBundleSchema>;
