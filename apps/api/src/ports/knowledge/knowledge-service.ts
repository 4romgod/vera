import type { Artifact } from '../../domain/artifacts/artifact.ts';
import type { AttachmentReference } from '../../domain/attachments/attachment.ts';
import type {
  KnowledgeSearchResponse,
  KnowledgeSourceResource,
} from '../../domain/knowledge/knowledge.ts';
import type { MemoryScope } from '../../domain/memories/memory.ts';

export type KnowledgeService = {
  add(input: {
    principalId: string;
    requestKey: string;
    title: string;
    scope: MemoryScope;
    sensitivity?: 'personal' | 'sensitive';
    attachmentIds?: string[];
    attachments?: AttachmentReference[];
    analysisArtifactId?: string;
    analysisArtifact?: Extract<Artifact, { type: 'attachment_analysis' }>;
    createdAt?: string;
  }): Promise<{ created: boolean; source: KnowledgeSourceResource }>;
  list(
    principalId: string,
    options?: {
      status?: 'active' | 'all';
      scope?: MemoryScope;
      limit?: number;
    },
  ): Promise<KnowledgeSourceResource[]>;
  get(principalId: string, sourceId: string): Promise<KnowledgeSourceResource>;
  remove(
    principalId: string,
    sourceId: string,
  ): Promise<KnowledgeSourceResource>;
  search(input: {
    principalId: string;
    query: string;
    scope?: MemoryScope;
    limit?: number;
    searchedAt?: string;
  }): Promise<KnowledgeSearchResponse>;
};
