import {
  KnowledgeSourceSchema,
  type KnowledgeSource,
} from '../../../../domain/knowledge/knowledge.ts';
import type {
  KnowledgeSourceId,
  KnowledgeStore,
} from '../../../../ports/persistence/knowledge-store.ts';

export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly sources = new Map<string, KnowledgeSource>();
  private readonly idsByRequest = new Map<string, string>();

  public create(source: KnowledgeSource) {
    const validated = KnowledgeSourceSchema.parse(source);
    const identity = this.identity(source.principalId, source.requestKey);
    const existingId = this.idsByRequest.get(identity);
    if (existingId !== undefined) {
      const existing = this.sources.get(existingId);
      if (existing === undefined) {
        throw new Error('In-memory knowledge request index is inconsistent.');
      }
      return Promise.resolve({
        created: false,
        source: structuredClone(existing),
      });
    }
    this.idsByRequest.set(identity, validated.id);
    this.sources.set(validated.id, structuredClone(validated));
    return Promise.resolve({
      created: true,
      source: structuredClone(validated),
    });
  }

  public findById(principalId: string, sourceId: KnowledgeSourceId) {
    const source = this.sources.get(sourceId);
    return Promise.resolve(
      source?.principalId === principalId ? structuredClone(source) : null,
    );
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const id = this.idsByRequest.get(this.identity(principalId, requestKey));
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public list(
    principalId: string,
    options: {
      status: 'active' | 'all';
      scope?: KnowledgeSource['scope'];
      limit: number;
    },
  ) {
    return Promise.resolve(
      [...this.sources.values()]
        .filter(
          (source) =>
            source.principalId === principalId &&
            (options.status === 'all' || source.status === 'active') &&
            (options.scope === undefined ||
              JSON.stringify(source.scope) === JSON.stringify(options.scope)),
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, options.limit)
        .map((source) => structuredClone(source)),
    );
  }

  public remove(input: {
    principalId: string;
    sourceId: KnowledgeSourceId;
    removedAt: string;
    expectedRevision: number;
  }) {
    const current = this.sources.get(input.sourceId);
    if (
      current?.principalId !== input.principalId ||
      current.revision !== input.expectedRevision
    ) {
      return Promise.resolve(null);
    }
    if (current.status === 'removed')
      return Promise.resolve(structuredClone(current));
    const removed = KnowledgeSourceSchema.parse({
      ...current,
      revision: current.revision + 1,
      status: 'removed',
      chunks: [],
      updatedAt: input.removedAt,
      removedAt: input.removedAt,
    });
    this.sources.set(removed.id, structuredClone(removed));
    return Promise.resolve(structuredClone(removed));
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.sources.clear();
    this.idsByRequest.clear();
    return Promise.resolve();
  }

  private identity(principalId: string, requestKey: string): string {
    return `${principalId}\u0000${requestKey}`;
  }
}
