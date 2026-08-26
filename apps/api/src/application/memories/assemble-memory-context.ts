import { createHash } from 'node:crypto';

import {
  MemoryContextBundleSchema,
  type MemoryContextBundle,
  type MemoryContextLimits,
} from '../../domain/memories/memory-context.ts';
import type { MemoryRecord } from '../../domain/memories/memory.ts';
import type { MemoryStore } from '../../ports/persistence/memory-store.ts';

function entryPayload(memory: MemoryRecord) {
  return {
    memoryId: memory.id,
    revision: memory.revision,
    kind: memory.kind,
    subject: memory.subject,
    content: memory.content,
    scope: memory.scope,
    sensitivity: memory.sensitivity,
    updatedAt: memory.updatedAt,
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function assembleMemoryContext(options: {
  store: MemoryStore;
  principalId: string;
  projectId?: string;
  assembledAt: string;
  limits: MemoryContextLimits;
}): Promise<MemoryContextBundle | undefined> {
  const [globalMemories, projectMemories, inScopeCount, differentScopeCount] =
    await Promise.all([
      options.store.listMemories(options.principalId, {
        status: 'active',
        scope: { kind: 'global' },
        limit: 100,
      }),
      options.projectId === undefined
        ? Promise.resolve([])
        : options.store.listMemories(options.principalId, {
            status: 'active',
            scope: { kind: 'project', projectId: options.projectId },
            limit: 100,
          }),
      options.store.countActiveMemoriesInScope(
        options.principalId,
        options.projectId,
      ),
      options.store.countActiveMemoriesOutsideScope(
        options.principalId,
        options.projectId,
      ),
    ]);
  const inScope = [...globalMemories, ...projectMemories].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
  const memories: MemoryContextBundle['memories'] = [];
  let totalCharacters = 0;
  for (const memory of inScope) {
    const payload = entryPayload(memory);
    const characters = memory.subject.length + memory.content.length;
    if (
      memories.length >= options.limits.maxMemories ||
      totalCharacters + characters > options.limits.maxCharacters
    ) {
      continue;
    }
    memories.push({
      ...payload,
      sha256: sha256(payload),
      characters,
    });
    totalCharacters += characters;
  }
  if (memories.length === 0) return undefined;
  const entries = memories.map(
    ({ memoryId, revision, sha256, characters }) => ({
      memoryId,
      revision,
      sha256,
      characters,
    }),
  );
  const manifestPayload = {
    schemaVersion: 1 as const,
    principalId: options.principalId,
    ...(options.projectId === undefined
      ? {}
      : { projectId: options.projectId }),
    entries,
    totalMemories: memories.length,
    totalCharacters,
    assembledAt: options.assembledAt,
    limits: options.limits,
    exclusions: {
      differentScope: differentScopeCount,
      limits: inScopeCount - memories.length,
    },
  };
  return MemoryContextBundleSchema.parse({
    schemaVersion: 1,
    memories,
    manifest: {
      ...manifestPayload,
      sha256: sha256(manifestPayload),
    },
  });
}
