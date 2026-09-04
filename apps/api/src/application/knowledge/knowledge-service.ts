import { createHash, randomUUID } from 'node:crypto';

import {
  AttachmentAnalysisArtifactSchema,
  type Artifact,
} from '../../domain/artifacts/artifact.ts';
import {
  AttachmentReferenceSchema,
  type Attachment,
  type AttachmentReference,
} from '../../domain/attachments/attachment.ts';
import {
  KnowledgeSearchResponseSchema,
  KnowledgeSourceIdSchema,
  KnowledgeSourceSchema,
  knowledgeSourceResource,
  sameAttachmentReferences,
  type KnowledgeSource,
} from '../../domain/knowledge/knowledge.ts';
import type { MemoryScope } from '../../domain/memories/memory.ts';
import type { ArtifactStore } from '../../ports/persistence/artifact-store.ts';
import type { AttachmentStore } from '../../ports/persistence/attachment-store.ts';
import type { KnowledgeStore } from '../../ports/persistence/knowledge-store.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';
import type { KnowledgeService } from '../../ports/knowledge/knowledge-service.ts';
import { ResourceError } from '../shared/resource-error.ts';

const MAX_INDEXED_SOURCES = 1_000;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function referenceFor(attachment: Attachment): AttachmentReference {
  return AttachmentReferenceSchema.parse({
    id: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
  });
}

function artifactIsIntact(artifact: Artifact): boolean {
  const content = JSON.stringify(artifact.content);
  return (
    artifact.byteLength === Buffer.byteLength(content) &&
    artifact.sha256 === digest(content)
  );
}

function tokenize(value: string): string[] {
  return (
    value
      .toLocaleLowerCase('en')
      .normalize('NFKC')
      .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) ?? []
  ).filter((token) => token.length > 1);
}

function excerpt(text: string, terms: readonly string[]): string {
  const lower = text.toLocaleLowerCase('en');
  const first = terms.reduce((best, term) => {
    const index = lower.indexOf(term);
    return index < 0 ? best : Math.min(best, index);
  }, Number.POSITIVE_INFINITY);
  const center = Number.isFinite(first) ? first : 0;
  const start = Math.max(0, center - 180);
  const end = Math.min(text.length, start + 700);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function sourceIsInScope(
  source: KnowledgeSource,
  scope?: MemoryScope,
): boolean {
  return (
    scope === undefined ||
    source.scope.kind === 'global' ||
    (scope.kind === 'project' && source.scope.projectId === scope.projectId)
  );
}

export function createKnowledgeService(options: {
  store: KnowledgeStore;
  attachments: AttachmentStore;
  artifacts: ArtifactStore;
  projects: ProjectStore;
  clock?: () => string;
  createId?: () => string;
}): KnowledgeService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => `knowledge_${randomUUID()}`);

  async function requireProjectScope(
    principalId: string,
    scope: MemoryScope,
  ): Promise<void> {
    if (scope.kind === 'global') return;
    if (
      (await options.projects.findProjectById(principalId, scope.projectId)) ===
      null
    ) {
      throw new ResourceError(
        `Project ${scope.projectId} was not found.`,
        'project_not_found',
      );
    }
  }

  async function loadAttachments(
    principalId: string,
    ids: readonly string[],
  ): Promise<{ attachment: Attachment; reference: AttachmentReference }[]> {
    if (
      ids.length === 0 ||
      ids.length > 5 ||
      new Set(ids).size !== ids.length
    ) {
      throw new ResourceError(
        'Knowledge requires between one and five unique attachments.',
        'invalid_knowledge_source',
      );
    }
    const loaded = await Promise.all(
      ids.map(async (id) => {
        const attachment = await options.attachments.findById(principalId, id);
        if (attachment === null) {
          throw new ResourceError(
            `Attachment ${id} was not found.`,
            'attachment_not_found',
          );
        }
        return { attachment, reference: referenceFor(attachment) };
      }),
    );
    return loaded;
  }

  async function loadAnalysis(
    principalId: string,
    artifactId?: string,
  ): Promise<Extract<Artifact, { type: 'attachment_analysis' }> | undefined> {
    if (artifactId === undefined) return undefined;
    const artifact = await options.artifacts.findArtifactById(
      principalId,
      artifactId,
    );
    if (
      artifact?.type !== 'attachment_analysis' ||
      !artifactIsIntact(artifact)
    ) {
      throw new ResourceError(
        'The attachment analysis is unavailable or failed integrity validation.',
        'invalid_knowledge_evidence',
      );
    }
    return AttachmentAnalysisArtifactSchema.parse(artifact);
  }

  return {
    async add(input) {
      await requireProjectScope(input.principalId, input.scope);
      const existing = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        const requestedAttachmentIds =
          input.attachmentIds ?? input.attachments?.map(({ id }) => id) ?? [];
        const existingAnalysisId = existing.provenance.analysisArtifact?.id;
        const requestedAnalysisId =
          input.analysisArtifactId ?? input.analysisArtifact?.id;
        if (
          existing.title !== input.title.trim() ||
          JSON.stringify(existing.scope) !== JSON.stringify(input.scope) ||
          existing.sensitivity !== (input.sensitivity ?? 'personal') ||
          existing.provenance.attachments.length !==
            requestedAttachmentIds.length ||
          existing.provenance.attachments.some(
            ({ id }, index) => id !== requestedAttachmentIds[index],
          ) ||
          existingAnalysisId !== requestedAnalysisId
        ) {
          throw new ResourceError(
            'The idempotency key was already used for different knowledge input.',
            'idempotency_key_reused',
          );
        }
        return { created: false, source: knowledgeSourceResource(existing) };
      }
      const frozenReferences = input.attachments;
      const ids =
        input.attachmentIds ?? frozenReferences?.map(({ id }) => id) ?? [];
      const loaded = await loadAttachments(input.principalId, ids);
      const references = loaded.map(({ reference }) => reference);
      if (
        frozenReferences !== undefined &&
        !sameAttachmentReferences(frozenReferences, references)
      ) {
        throw new ResourceError(
          'The attachments no longer match the approved knowledge evidence.',
          'invalid_knowledge_evidence',
        );
      }
      const analysis =
        input.analysisArtifact ??
        (await loadAnalysis(input.principalId, input.analysisArtifactId));
      if (analysis !== undefined && !artifactIsIntact(analysis)) {
        throw new ResourceError(
          'The attachment analysis failed integrity validation.',
          'invalid_knowledge_evidence',
        );
      }
      const includesImage = loaded.some(
        ({ attachment }) => attachment.kind === 'image',
      );
      if (includesImage && analysis === undefined) {
        throw new ResourceError(
          'Image knowledge requires a completed attachment analysis.',
          'knowledge_analysis_required',
        );
      }
      if (analysis !== undefined) {
        const analyzedReferences = analysis.content.attachments.map(
          (attachment) => {
            const loadedAttachment = loaded.find(
              (candidate) => candidate.reference.id === attachment.id,
            )?.reference;
            if (
              loadedAttachment?.kind !== attachment.kind ||
              loadedAttachment.filename !== attachment.filename ||
              loadedAttachment.mediaType !== attachment.mediaType ||
              loadedAttachment.sha256 !== attachment.sha256
            ) {
              throw new ResourceError(
                'The attachment analysis does not match the selected knowledge sources.',
                'invalid_knowledge_evidence',
              );
            }
            return loadedAttachment;
          },
        );
        if (!sameAttachmentReferences(references, analyzedReferences)) {
          throw new ResourceError(
            'The attachment analysis covers a different evidence set.',
            'invalid_knowledge_evidence',
          );
        }
      }
      const sourceId = KnowledgeSourceIdSchema.parse(createId());
      const chunkDrafts = loaded.flatMap(({ attachment }) =>
        attachment.kind === 'document'
          ? attachment.extraction.segments.map((segment) => ({
              locator: `${attachment.filename} · ${segment.locator}`,
              text: segment.text,
            }))
          : [],
      );
      if (includesImage && analysis !== undefined) {
        chunkDrafts.push({
          locator: 'attachment analysis · summary',
          text: analysis.content.summary,
        });
        analysis.content.findings.forEach((finding, index) =>
          chunkDrafts.push({
            locator: `attachment analysis · finding ${String(index + 1)}`,
            text: finding,
          }),
        );
      }
      const bounded = chunkDrafts.slice(0, 400);
      const chunks = bounded.map((chunk, index) => ({
        id: `knowledge_chunk_${sourceId.slice('knowledge_'.length)}_${String(index + 1)}`,
        locator: chunk.locator,
        text: chunk.text,
        sha256: digest(chunk.text),
      }));
      const createdAt = input.createdAt ?? clock();
      const source = KnowledgeSourceSchema.parse({
        schemaVersion: 1,
        id: sourceId,
        revision: 1,
        principalId: input.principalId,
        requestKey: input.requestKey,
        title: input.title,
        scope: input.scope,
        sensitivity: input.sensitivity ?? 'personal',
        status: 'active',
        provenance: {
          kind: 'owner_attachments',
          attachments: references,
          ...(analysis === undefined
            ? {}
            : {
                analysisArtifact: {
                  id: analysis.id,
                  version: analysis.version,
                  type: analysis.type,
                  mediaType: analysis.mediaType,
                  sha256: analysis.sha256,
                  byteLength: analysis.byteLength,
                },
              }),
        },
        chunks,
        contentSha256: digest(JSON.stringify(chunks)),
        createdAt,
        updatedAt: createdAt,
      });
      const stored = await options.store.create(source);
      return {
        created: stored.created,
        source: knowledgeSourceResource(stored.source),
      };
    },

    async list(principalId, query = {}) {
      const sources = await options.store.list(principalId, {
        status: query.status ?? 'active',
        limit: query.limit ?? 100,
        ...(query.scope === undefined ? {} : { scope: query.scope }),
      });
      return sources.map(knowledgeSourceResource);
    },

    async get(principalId, sourceId) {
      const parsedId = KnowledgeSourceIdSchema.parse(sourceId);
      const source = await options.store.findById(principalId, parsedId);
      if (source === null) {
        throw new ResourceError(
          `Knowledge source ${sourceId} was not found.`,
          'knowledge_source_not_found',
        );
      }
      return knowledgeSourceResource(source);
    },

    async remove(principalId, sourceId) {
      const parsedId = KnowledgeSourceIdSchema.parse(sourceId);
      const current = await options.store.findById(principalId, parsedId);
      if (current === null) {
        throw new ResourceError(
          `Knowledge source ${sourceId} was not found.`,
          'knowledge_source_not_found',
        );
      }
      if (current.status === 'removed') return knowledgeSourceResource(current);
      const removed = await options.store.remove({
        principalId,
        sourceId: parsedId,
        removedAt: clock(),
        expectedRevision: current.revision,
      });
      if (removed === null) {
        throw new ResourceError(
          'The knowledge source changed while it was being removed.',
          'knowledge_source_conflict',
        );
      }
      return knowledgeSourceResource(removed);
    },

    async search(input) {
      const query = input.query.trim();
      const terms = [...new Set(tokenize(query))];
      if (terms.length === 0) {
        return KnowledgeSearchResponseSchema.parse({
          schemaVersion: 1,
          query,
          citations: [],
          searchedAt: input.searchedAt ?? clock(),
        });
      }
      const scope = input.scope;
      if (scope !== undefined) {
        await requireProjectScope(input.principalId, scope);
      }
      const sources = (
        await options.store.list(input.principalId, {
          status: 'active',
          limit: MAX_INDEXED_SOURCES,
        })
      ).filter((source) => sourceIsInScope(source, scope));
      const candidates = sources.flatMap((source) => {
        if (source.contentSha256 !== digest(JSON.stringify(source.chunks))) {
          throw new ResourceError(
            `Knowledge source ${source.id} failed integrity validation.`,
            'knowledge_integrity_failure',
          );
        }
        return source.chunks.flatMap((chunk) => {
          if (chunk.sha256 !== digest(chunk.text)) {
            throw new ResourceError(
              `Knowledge source ${source.id} failed chunk integrity validation.`,
              'knowledge_integrity_failure',
            );
          }
          const text = `${source.title}\n${chunk.text}`.toLocaleLowerCase('en');
          const matched = terms.filter((term) => text.includes(term));
          if (matched.length === 0) return [];
          const frequency = matched.reduce(
            (total, term) => total + Math.min(text.split(term).length - 1, 5),
            0,
          );
          const coverage = matched.length / terms.length;
          const phrase = text.includes(query.toLocaleLowerCase('en')) ? 6 : 0;
          return [
            {
              source,
              chunk,
              score: Number((coverage * 10 + frequency + phrase).toFixed(4)),
            },
          ];
        });
      });
      const citations = candidates
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.source.updatedAt.localeCompare(left.source.updatedAt) ||
            left.chunk.id.localeCompare(right.chunk.id),
        )
        .slice(0, input.limit ?? 8)
        .map(({ source, chunk, score }) => ({
          sourceId: source.id,
          sourceTitle: source.title,
          chunkId: chunk.id,
          locator: chunk.locator,
          excerpt: excerpt(chunk.text, terms),
          score,
          attachments: source.provenance.attachments,
        }));
      return KnowledgeSearchResponseSchema.parse({
        schemaVersion: 1,
        query,
        citations,
        searchedAt: input.searchedAt ?? clock(),
      });
    },
  };
}
