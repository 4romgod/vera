import { createHash } from 'node:crypto';

import type { MemoryContextBundle } from '../../domain/memories/memory-context.ts';
import type { MemoryStore } from '../../ports/persistence/memory-store.ts';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function assertMemoryContextIntegrity(options: {
  context: MemoryContextBundle;
  store: MemoryStore;
  principalId: string;
  projectId?: string;
}): Promise<void> {
  const { context } = options;
  if (
    context.manifest.principalId !== options.principalId ||
    context.manifest.projectId !== options.projectId ||
    context.memories.length !== context.manifest.totalMemories ||
    context.manifest.entries.length !== context.memories.length
  ) {
    throw new Error('Memory context identity or totals do not match.');
  }
  let totalCharacters = 0;
  for (const [index, entry] of context.memories.entries()) {
    const manifestEntry = context.manifest.entries[index];
    const stored = await options.store.findMemoryById(
      options.principalId,
      entry.memoryId,
    );
    if (
      stored?.status !== 'active' ||
      stored.revision !== entry.revision ||
      (stored.scope.kind === 'project' &&
        stored.scope.projectId !== options.projectId)
    ) {
      throw new Error(
        `Memory ${entry.memoryId} is missing, stale, or out of scope.`,
      );
    }
    const payload = {
      memoryId: stored.id,
      revision: stored.revision,
      kind: stored.kind,
      subject: stored.subject,
      content: stored.content,
      scope: stored.scope,
      sensitivity: stored.sensitivity,
      updatedAt: stored.updatedAt,
    };
    const characters = stored.subject.length + stored.content.length;
    if (
      entry.kind !== stored.kind ||
      entry.subject !== stored.subject ||
      entry.content !== stored.content ||
      JSON.stringify(entry.scope) !== JSON.stringify(stored.scope) ||
      entry.sensitivity !== stored.sensitivity ||
      entry.updatedAt !== stored.updatedAt ||
      sha256(payload) !== entry.sha256 ||
      manifestEntry?.memoryId !== entry.memoryId ||
      manifestEntry.revision !== entry.revision ||
      manifestEntry.sha256 !== entry.sha256 ||
      manifestEntry.characters !== characters ||
      entry.characters !== characters
    ) {
      throw new Error(`Memory ${entry.memoryId} failed integrity validation.`);
    }
    totalCharacters += characters;
  }
  const manifestPayload = {
    schemaVersion: context.manifest.schemaVersion,
    principalId: options.principalId,
    ...(options.projectId === undefined
      ? {}
      : { projectId: options.projectId }),
    entries: context.manifest.entries,
    totalMemories: context.memories.length,
    totalCharacters,
    assembledAt: context.manifest.assembledAt,
    limits: context.manifest.limits,
    exclusions: context.manifest.exclusions,
  };
  if (
    totalCharacters !== context.manifest.totalCharacters ||
    sha256(manifestPayload) !== context.manifest.sha256 ||
    context.memories.length > context.manifest.limits.maxMemories ||
    totalCharacters > context.manifest.limits.maxCharacters
  ) {
    throw new Error('Memory context manifest failed integrity validation.');
  }
}
