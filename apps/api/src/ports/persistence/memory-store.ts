import type {
  MemoryActionArguments,
  MemoryRecord,
} from '../../domain/memories/memory.ts';

export type MemoryListOptions = {
  kind?: MemoryRecord['kind'];
  scope?: MemoryRecord['scope'];
  status: 'active' | 'all';
  limit: number;
};

export type MemoryStore = {
  createMemory(memory: MemoryRecord): Promise<MemoryRecord>;
  correctMemory(input: {
    principalId: string;
    memoryId: string;
    replacement: Pick<
      MemoryRecord,
      'kind' | 'subject' | 'content' | 'scope' | 'sensitivity' | 'provenance'
    >;
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<MemoryRecord | null>;
  forgetMemory(input: {
    principalId: string;
    memoryId: string;
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<MemoryRecord | null>;
  findMemoryById(
    principalId: string,
    memoryId: string,
  ): Promise<MemoryRecord | null>;
  findMemoryByInvocation(
    principalId: string,
    invocationId: string,
  ): Promise<MemoryRecord | null>;
  listMemories(
    principalId: string,
    options: MemoryListOptions,
  ): Promise<MemoryRecord[]>;
  countActiveMemoriesOutsideScope(
    principalId: string,
    projectId?: string,
  ): Promise<number>;
  countActiveMemoriesInScope(
    principalId: string,
    projectId?: string,
  ): Promise<number>;
};

export function memoryIdForInvocation(invocationId: string): string {
  return `memory_${invocationId.slice('invocation_'.length)}`;
}

export function memoryMutationOrderKey(
  mutationAt: string,
  invocationId: string,
): string {
  return `${mutationAt}\u0000${invocationId}`;
}

export type MemoryStoreAction = MemoryActionArguments;
