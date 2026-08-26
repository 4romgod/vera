import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LocalMemoryActionExecutor } from '../../../../../src/adapters/outbound/integrations/memories/local-memory-action-executor.ts';
import { InMemoryOwnerResourceStore } from '../../../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { MEMORY_HISTORY_LIMIT } from '../../../../../src/domain/memories/memory.ts';
import { memoryMutationOrderKey } from '../../../../../src/ports/persistence/memory-store.ts';

const source = {
  taskId: 'task_memory',
  conversationId: 'conversation_memory',
  messageId: 'message_memory',
};

void describe('local governed-memory integration adapter', () => {
  void it('remembers, versions corrections, forgets, and replays each exact mutation idempotently', async () => {
    const store = new InMemoryOwnerResourceStore();
    const executor = new LocalMemoryActionExecutor(store);
    const remember = {
      principalId: 'owner_v1',
      invocationId: 'invocation_remember',
      startedAt: '2026-08-26T10:00:00.000Z',
      recovery: false,
      source,
      arguments: {
        action: 'remember' as const,
        kind: 'preference' as const,
        subject: 'Package manager',
        content: 'I prefer npm workspaces.',
        scope: { kind: 'global' as const },
      },
    };
    const created = await executor.execute(remember);
    assert.deepEqual(await executor.execute(remember), created);
    const memoryId = created.memories[0]?.id;
    assert.ok(memoryId);
    assert.equal(created.memories[0]?.revision, 1);

    const corrected = await executor.execute({
      principalId: 'owner_v1',
      invocationId: 'invocation_correct',
      startedAt: '2026-08-26T10:01:00.000Z',
      recovery: false,
      source: { ...source, messageId: 'message_correction' },
      arguments: {
        action: 'correct',
        memoryId,
        content: 'I prefer pnpm workspaces.',
      },
    });
    const correctedMemory = corrected.memories[0];
    assert.ok(correctedMemory);
    assert.equal(correctedMemory.revision, 2);
    assert.equal(correctedMemory.history.length, 1);
    assert.equal(
      correctedMemory.history[0]?.content,
      'I prefer npm workspaces.',
    );

    const forgotten = await executor.execute({
      principalId: 'owner_v1',
      invocationId: 'invocation_forget',
      startedAt: '2026-08-26T10:02:00.000Z',
      recovery: false,
      source: { ...source, messageId: 'message_forget' },
      arguments: { action: 'forget', memoryId },
    });
    assert.equal(forgotten.memories[0]?.status, 'forgotten');
    assert.equal(
      (await store.listMemories('owner_v1', { status: 'active', limit: 50 }))
        .length,
      0,
    );
    assert.equal(
      (await store.listMemories('owner_v1', { status: 'all', limit: 50 }))
        .length,
      1,
    );
    assert.equal(await store.findMemoryById('another_owner', memoryId), null);
  });

  void it('requires real project identity for project-scoped memory and discloses read-only list authority', async () => {
    const executor = new LocalMemoryActionExecutor(
      new InMemoryOwnerResourceStore(),
    );
    assert.deepEqual(executor.authorityFor({ action: 'list' }).sideEffects, []);
    assert.deepEqual(
      executor.authorityFor({
        action: 'remember',
        kind: 'project_knowledge',
        subject: 'Architecture',
        content: 'Uses workspaces.',
        scope: { kind: 'project', projectId: 'project_missing' },
      }).sideEffects,
      ['personal_data_write'],
    );
    await assert.rejects(
      executor.execute({
        principalId: 'owner_v1',
        invocationId: 'invocation_project',
        startedAt: '2026-08-26T10:00:00.000Z',
        recovery: false,
        source,
        arguments: {
          action: 'remember',
          kind: 'project_knowledge',
          subject: 'Architecture',
          content: 'Uses workspaces.',
          scope: { kind: 'project', projectId: 'project_missing' },
        },
      }),
      /was not found for memory scope/u,
    );
  });

  void it('rejects corrections before a bounded history would become unreadable', async () => {
    const store = new InMemoryOwnerResourceStore();
    const createdAt = '2026-08-26T10:00:00.000Z';
    const provenance = {
      source: 'owner_message' as const,
      taskId: 'task_history',
      invocationId: 'invocation_history_create',
    };
    await store.createMemory({
      schemaVersion: 1,
      id: 'memory_history_limit',
      revision: MEMORY_HISTORY_LIMIT + 1,
      principalId: 'owner_v1',
      kind: 'fact',
      subject: 'Bounded history',
      content: 'Current value.',
      scope: { kind: 'global' },
      sensitivity: 'personal',
      status: 'active',
      provenance,
      creationInvocationId: provenance.invocationId,
      history: Array.from({ length: MEMORY_HISTORY_LIMIT }, (_, index) => ({
        revision: index + 1,
        kind: 'fact' as const,
        subject: 'Bounded history',
        content: `Prior value ${String(index + 1)}.`,
        scope: { kind: 'global' as const },
        sensitivity: 'personal' as const,
        provenance,
        supersededAt: new Date(Date.parse(createdAt) + index + 1).toISOString(),
      })),
      createdAt,
      updatedAt: new Date(
        Date.parse(createdAt) + MEMORY_HISTORY_LIMIT,
      ).toISOString(),
      lastMutation: {
        invocationId: 'invocation_history_latest',
        orderKey: memoryMutationOrderKey(
          new Date(Date.parse(createdAt) + MEMORY_HISTORY_LIMIT).toISOString(),
          'invocation_history_latest',
        ),
      },
    });

    assert.throws(
      () =>
        store.correctMemory({
          principalId: 'owner_v1',
          memoryId: 'memory_history_limit',
          replacement: {
            kind: 'fact',
            subject: 'Bounded history',
            content: 'One correction too many.',
            scope: { kind: 'global' },
            sensitivity: 'personal',
            provenance: {
              ...provenance,
              invocationId: 'invocation_history_overflow',
            },
          },
          invocationId: 'invocation_history_overflow',
          mutationAt: '2026-08-26T11:00:00.000Z',
          recovery: false,
        }),
      /history limit reached/u,
    );
    const unchanged = await store.findMemoryById(
      'owner_v1',
      'memory_history_limit',
    );
    assert.ok(unchanged);
    assert.equal(unchanged.content, 'Current value.');
    assert.equal(unchanged.history.length, MEMORY_HISTORY_LIMIT);
  });
});
