import {
  MemoryResourceSchema,
  memoryResource,
  type MemoryResource,
} from '../../domain/memories/memory.ts';
import type { MemoryStore } from '../../ports/persistence/memory-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type MemoryService = {
  list(
    principalId: string,
    options?: Parameters<MemoryStore['listMemories']>[1],
  ): Promise<MemoryResource[]>;
  get(principalId: string, memoryId: string): Promise<MemoryResource>;
};

export function createMemoryService(options: {
  store: MemoryStore;
}): MemoryService {
  return {
    async list(principalId, query) {
      const memories = await options.store.listMemories(principalId, {
        status: query?.status ?? 'active',
        limit: query?.limit ?? 50,
        ...(query?.kind === undefined ? {} : { kind: query.kind }),
        ...(query?.scope === undefined ? {} : { scope: query.scope }),
      });
      return memories.map((memory) =>
        MemoryResourceSchema.parse(memoryResource(memory)),
      );
    },
    async get(principalId, memoryId) {
      const memory = await options.store.findMemoryById(principalId, memoryId);
      if (memory === null) {
        throw new ResourceError(
          `Memory ${memoryId} was not found.`,
          'memory_not_found',
        );
      }
      return memoryResource(memory);
    },
  };
}
