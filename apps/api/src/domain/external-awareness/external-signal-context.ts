import { z } from 'zod';

import {
  ExternalSignalCategorySchema,
  ExternalSignalSchema,
} from './external-signal.ts';

// Zod does not permit pick() on a refined object at runtime. Reusing the
// original field schemas keeps the immutable snapshot contract aligned.
export const ExternalSignalContextEntrySchema = z
  .object({
    id: ExternalSignalSchema.shape.id,
    version: ExternalSignalSchema.shape.version,
    routineId: ExternalSignalSchema.shape.routineId,
    integrationId: ExternalSignalSchema.shape.integrationId,
    connectionId: ExternalSignalSchema.shape.connectionId,
    project: ExternalSignalSchema.shape.project,
    repository: ExternalSignalSchema.shape.repository,
    externalKey: ExternalSignalSchema.shape.externalKey,
    category: ExternalSignalCategorySchema,
    title: ExternalSignalSchema.shape.title,
    summary: ExternalSignalSchema.shape.summary,
    url: ExternalSignalSchema.shape.url,
    occurredAt: ExternalSignalSchema.shape.occurredAt,
    status: ExternalSignalSchema.shape.status,
    firstObservedAt: ExternalSignalSchema.shape.firstObservedAt,
    lastObservedAt: ExternalSignalSchema.shape.lastObservedAt,
    resolvedAt: ExternalSignalSchema.shape.resolvedAt,
    characters: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const ExternalSignalContextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    principalId: z.string().min(1),
    signalId: z.string().startsWith('external_signal_'),
    signalVersion: z.number().int().positive(),
    projectId: z.string().startsWith('project_'),
    assembledAt: z.iso.datetime(),
    characters: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const ExternalSignalContextBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    signal: ExternalSignalContextEntrySchema,
    manifest: ExternalSignalContextManifestSchema,
  })
  .strict();

export type ExternalSignalContextBundle = z.infer<
  typeof ExternalSignalContextBundleSchema
>;
