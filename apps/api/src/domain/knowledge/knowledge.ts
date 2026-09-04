import { z } from 'zod';

import {
  AttachmentReferenceSchema,
  type AttachmentReference,
} from '../attachments/attachment.ts';
import {
  MemoryScopeSchema,
  MemorySensitivitySchema,
} from '../memories/memory.ts';

export const KnowledgeSourceIdSchema = z
  .string()
  .regex(/^knowledge_[a-z0-9][a-z0-9_-]*$/u);

export const KnowledgeChunkSchema = z
  .object({
    id: z.string().regex(/^knowledge_chunk_[a-z0-9][a-z0-9_-]*$/u),
    locator: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(4_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const KnowledgeSourceBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: KnowledgeSourceIdSchema,
    revision: z.number().int().positive(),
    principalId: z.string().min(1),
    requestKey: z.string().trim().min(8).max(200),
    title: z.string().trim().min(1).max(200),
    scope: MemoryScopeSchema,
    sensitivity: MemorySensitivitySchema,
    status: z.enum(['active', 'removed']),
    provenance: z
      .object({
        kind: z.literal('owner_attachments'),
        attachments: z.array(AttachmentReferenceSchema).min(1).max(5),
        analysisArtifact: z
          .object({
            id: z.string().startsWith('artifact_'),
            version: z.literal(1),
            type: z.literal('attachment_analysis'),
            mediaType: z.literal(
              'application/vnd.vera.attachment-analysis+json',
            ),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
            byteLength: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    chunks: z.array(KnowledgeChunkSchema).max(400),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    removedAt: z.iso.datetime().optional(),
  })
  .strict();

export const KnowledgeSourceSchema = KnowledgeSourceBaseSchema.superRefine(
  (source, context) => {
    if (source.status === 'active' && source.chunks.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['chunks'],
        message: 'An active knowledge source requires searchable chunks.',
      });
    }
    if (source.status === 'removed' && source.chunks.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['chunks'],
        message: 'A removed knowledge source must not retain searchable text.',
      });
    }
  },
);

export const KnowledgeSourceResourceSchema = KnowledgeSourceBaseSchema.omit({
  principalId: true,
  requestKey: true,
  chunks: true,
}).extend({
  chunkCount: z.number().int().nonnegative().max(400),
});

export const KnowledgeSearchCitationSchema = z
  .object({
    sourceId: KnowledgeSourceIdSchema,
    sourceTitle: z.string().trim().min(1).max(200),
    chunkId: KnowledgeChunkSchema.shape.id,
    locator: KnowledgeChunkSchema.shape.locator,
    excerpt: z.string().trim().min(1).max(700),
    score: z.number().nonnegative(),
    attachments: z.array(AttachmentReferenceSchema).min(1).max(5),
  })
  .strict();

export const KnowledgeSearchResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    query: z.string().trim().min(1).max(2_000),
    citations: z.array(KnowledgeSearchCitationSchema).max(12),
    searchedAt: z.iso.datetime(),
  })
  .strict();

const AddKnowledgeArgumentsSchema = z
  .object({
    action: z.literal('add'),
    title: z.string().trim().min(1).max(200),
    scope: MemoryScopeSchema,
    sensitivity: MemorySensitivitySchema.optional(),
  })
  .strict();

const SearchKnowledgeArgumentsSchema = z
  .object({
    action: z.literal('search'),
    query: z.string().trim().min(1).max(2_000),
    scope: MemoryScopeSchema.optional(),
    limit: z.number().int().positive().max(12).optional(),
  })
  .strict();

const ListKnowledgeArgumentsSchema = z
  .object({
    action: z.literal('list'),
    scope: MemoryScopeSchema.optional(),
    status: z.enum(['active', 'all']).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const RemoveKnowledgeArgumentsSchema = z
  .object({
    action: z.literal('remove'),
    sourceId: KnowledgeSourceIdSchema,
  })
  .strict();

export const KnowledgeActionArgumentsSchema = z.discriminatedUnion('action', [
  AddKnowledgeArgumentsSchema,
  SearchKnowledgeArgumentsSchema,
  ListKnowledgeArgumentsSchema,
  RemoveKnowledgeArgumentsSchema,
]);

export const KnowledgeAnswerModelSchema = z
  .object({
    answer: z.string().trim().min(1).max(10_000),
    citationIds: z.array(z.string().regex(/^source_[1-9][0-9]*$/u)).max(12),
    limitations: z.array(z.string().trim().min(1).max(1_000)).max(10),
  })
  .strict();

export const KnowledgeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.enum(['add', 'search', 'list', 'remove']),
    summary: z.string().trim().min(1).max(1_000),
    sources: z.array(KnowledgeSourceResourceSchema).max(100),
    query: z.string().trim().min(1).max(2_000).optional(),
    answer: z.string().trim().min(1).max(10_000).optional(),
    citations: z.array(KnowledgeSearchCitationSchema).max(12).optional(),
    limitations: z
      .array(z.string().trim().min(1).max(1_000))
      .max(10)
      .optional(),
  })
  .strict()
  .superRefine((result, context) => {
    const searchFields = [
      result.query,
      result.answer,
      result.citations,
      result.limitations,
    ];
    if (
      result.action === 'search' &&
      searchFields.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A knowledge search result requires query, answer, citations, and limitations.',
      });
    }
    if (
      result.action !== 'search' &&
      searchFields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only a knowledge search result may contain answer fields.',
      });
    }
    if (
      (result.action === 'add' || result.action === 'remove') &&
      result.sources.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'A knowledge mutation result requires exactly one source.',
      });
    }
  });

export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
export type KnowledgeSourceResource = z.infer<
  typeof KnowledgeSourceResourceSchema
>;
export type KnowledgeSearchCitation = z.infer<
  typeof KnowledgeSearchCitationSchema
>;
export type KnowledgeSearchResponse = z.infer<
  typeof KnowledgeSearchResponseSchema
>;
export type KnowledgeActionArguments = z.infer<
  typeof KnowledgeActionArgumentsSchema
>;
export type KnowledgeResult = z.infer<typeof KnowledgeResultSchema>;

export function knowledgeSourceResource(
  source: KnowledgeSource,
): KnowledgeSourceResource {
  const {
    principalId: ignoredPrincipal,
    requestKey: ignoredRequestKey,
    chunks,
    ...resource
  } = source;
  void ignoredPrincipal;
  void ignoredRequestKey;
  return KnowledgeSourceResourceSchema.parse({
    ...resource,
    chunkCount: chunks.length,
  });
}

export function sameAttachmentReferences(
  left: readonly AttachmentReference[],
  right: readonly AttachmentReference[],
): boolean {
  return (
    left.length === right.length &&
    left.every((reference, index) => {
      const candidate = right[index];
      return (
        reference.id === candidate?.id &&
        reference.kind === candidate.kind &&
        reference.filename === candidate.filename &&
        reference.mediaType === candidate.mediaType &&
        reference.sha256 === candidate.sha256 &&
        reference.byteLength === candidate.byteLength
      );
    })
  );
}
