import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assembleMemoryContext } from '../../../src/application/memories/assemble-memory-context.ts';
import { assertMemoryContextIntegrity } from '../../../src/application/memories/validate-memory-context.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { memoryMutationOrderKey } from '../../../src/ports/persistence/memory-store.ts';

async function seed(
  store: InMemoryOwnerResourceStore,
  input: {
    id: string;
    invocationId: string;
    content: string;
    scope: { kind: 'global' } | { kind: 'project'; projectId: string };
    updatedAt: string;
  },
) {
  await store.createMemory({
    schemaVersion: 1,
    id: input.id,
    revision: 1,
    principalId: 'owner_v1',
    kind: input.scope.kind === 'global' ? 'preference' : 'project_knowledge',
    subject: input.id,
    content: input.content,
    scope: input.scope,
    sensitivity: 'personal',
    status: 'active',
    provenance: {
      source: 'owner_message',
      taskId: `task_${input.invocationId}`,
      invocationId: input.invocationId,
    },
    creationInvocationId: input.invocationId,
    history: [],
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    lastMutation: {
      invocationId: input.invocationId,
      orderKey: memoryMutationOrderKey(input.updatedAt, input.invocationId),
    },
  });
}

void describe('governed memory context', () => {
  void it('selects only global and exact-project memories within deterministic limits', async () => {
    const store = new InMemoryOwnerResourceStore();
    await seed(store, {
      id: 'memory_global',
      invocationId: 'invocation_global',
      content: 'Use npm.',
      scope: { kind: 'global' },
      updatedAt: '2026-08-26T10:00:00.000Z',
    });
    await seed(store, {
      id: 'memory_project_a',
      invocationId: 'invocation_project_a',
      content: 'Project A uses MongoDB.',
      scope: { kind: 'project', projectId: 'project_a' },
      updatedAt: '2026-08-26T10:01:00.000Z',
    });
    await seed(store, {
      id: 'memory_project_b',
      invocationId: 'invocation_project_b',
      content: 'Project B uses DynamoDB.',
      scope: { kind: 'project', projectId: 'project_b' },
      updatedAt: '2026-08-26T10:02:00.000Z',
    });
    const context = await assembleMemoryContext({
      store,
      principalId: 'owner_v1',
      projectId: 'project_a',
      assembledAt: '2026-08-26T10:03:00.000Z',
      limits: { maxMemories: 2, maxCharacters: 1_000 },
    });
    assert.ok(context);
    assert.deepEqual(
      context.memories.map(({ memoryId }) => memoryId),
      ['memory_project_a', 'memory_global'],
    );
    assert.equal(context.manifest.exclusions.differentScope, 1);
    await assertMemoryContextIntegrity({
      context,
      store,
      principalId: 'owner_v1',
      projectId: 'project_a',
    });
  });

  void it('scopes candidates before applying the bounded context window', async () => {
    const store = new InMemoryOwnerResourceStore();
    await seed(store, {
      id: 'memory_relevant_global',
      invocationId: 'invocation_relevant_global',
      content: 'Use npm workspaces.',
      scope: { kind: 'global' },
      updatedAt: '2026-08-26T09:00:00.000Z',
    });
    await seed(store, {
      id: 'memory_relevant_project',
      invocationId: 'invocation_relevant_project',
      content: 'Project A uses MongoDB.',
      scope: { kind: 'project', projectId: 'project_a' },
      updatedAt: '2026-08-26T09:01:00.000Z',
    });
    for (let index = 0; index < 100; index += 1) {
      const suffix = index.toString().padStart(3, '0');
      await seed(store, {
        id: `memory_unrelated_${suffix}`,
        invocationId: `invocation_unrelated_${suffix}`,
        content: `Project B memory ${suffix}.`,
        scope: { kind: 'project', projectId: 'project_b' },
        updatedAt: new Date(
          Date.parse('2026-08-26T10:00:00.000Z') + index,
        ).toISOString(),
      });
    }

    const context = await assembleMemoryContext({
      store,
      principalId: 'owner_v1',
      projectId: 'project_a',
      assembledAt: '2026-08-26T11:00:00.000Z',
      limits: { maxMemories: 2, maxCharacters: 1_000 },
    });

    assert.ok(context);
    assert.deepEqual(
      context.memories.map(({ memoryId }) => memoryId),
      ['memory_relevant_project', 'memory_relevant_global'],
    );
    assert.equal(context.manifest.exclusions.differentScope, 100);
    assert.equal(context.manifest.exclusions.limits, 0);
  });

  void it('fails closed when a frozen memory is corrected after assembly or its content is tampered', async () => {
    const store = new InMemoryOwnerResourceStore();
    await seed(store, {
      id: 'memory_integrity',
      invocationId: 'invocation_integrity',
      content: 'Use npm.',
      scope: { kind: 'global' },
      updatedAt: '2026-08-26T10:00:00.000Z',
    });
    const context = await assembleMemoryContext({
      store,
      principalId: 'owner_v1',
      assembledAt: '2026-08-26T10:01:00.000Z',
      limits: { maxMemories: 20, maxCharacters: 12_000 },
    });
    assert.ok(context);
    const tampered = structuredClone(context);
    const tamperedMemory = tampered.memories[0];
    assert.ok(tamperedMemory);
    tamperedMemory.content = 'Use something else.';
    await assert.rejects(
      assertMemoryContextIntegrity({
        context: tampered,
        store,
        principalId: 'owner_v1',
      }),
      /failed integrity validation/u,
    );

    const tamperedManifest = structuredClone(context);
    tamperedManifest.manifest.exclusions.limits += 1;
    await assert.rejects(
      assertMemoryContextIntegrity({
        context: tamperedManifest,
        store,
        principalId: 'owner_v1',
      }),
      /manifest failed integrity validation/u,
    );

    const current = await store.findMemoryById('owner_v1', 'memory_integrity');
    assert.ok(current);
    await store.correctMemory({
      principalId: 'owner_v1',
      memoryId: current.id,
      replacement: {
        kind: current.kind,
        subject: current.subject,
        content: 'Use pnpm.',
        scope: current.scope,
        sensitivity: current.sensitivity,
        provenance: {
          source: 'owner_message',
          taskId: 'task_correction',
          invocationId: 'invocation_correction',
        },
      },
      invocationId: 'invocation_correction',
      mutationAt: '2026-08-26T10:02:00.000Z',
      recovery: false,
    });
    await assert.rejects(
      assertMemoryContextIntegrity({
        context,
        store,
        principalId: 'owner_v1',
      }),
      /missing, stale, or out of scope/u,
    );
  });
});
