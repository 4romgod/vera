import { KnowledgeSourceIdSchema } from '../../domain/knowledge/knowledge.ts';
import type { KnowledgeSource } from '../../domain/knowledge/knowledge.ts';
import type { z } from 'zod';

export type KnowledgeSourceId = z.infer<typeof KnowledgeSourceIdSchema>;

export type KnowledgeStore = {
  create(source: KnowledgeSource): Promise<{
    created: boolean;
    source: KnowledgeSource;
  }>;
  findById(
    principalId: string,
    sourceId: KnowledgeSourceId,
  ): Promise<KnowledgeSource | null>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<KnowledgeSource | null>;
  list(
    principalId: string,
    options: {
      status: 'active' | 'all';
      scope?: KnowledgeSource['scope'];
      limit: number;
    },
  ): Promise<KnowledgeSource[]>;
  remove(input: {
    principalId: string;
    sourceId: KnowledgeSourceId;
    removedAt: string;
    expectedRevision: number;
  }): Promise<KnowledgeSource | null>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
