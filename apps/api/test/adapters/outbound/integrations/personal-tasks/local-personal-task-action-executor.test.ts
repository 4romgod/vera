import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LocalPersonalTaskActionExecutor } from '../../../../../src/adapters/outbound/integrations/personal-tasks/local-personal-task-action-executor.ts';
import { InMemoryOwnerResourceStore } from '../../../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';

void describe('local personal-task integration adapter', () => {
  void it('applies exact actions idempotently and rejects a stale mutation', async () => {
    const store = new InMemoryOwnerResourceStore();
    const executor = new LocalPersonalTaskActionExecutor(store);
    const create = {
      principalId: 'owner_v1',
      invocationId: 'invocation_create',
      startedAt: '2026-08-26T10:00:00.000Z',
      recovery: false,
      arguments: { action: 'create' as const, title: 'Buy milk' },
    };

    const first = await executor.execute(create);
    const replay = await executor.execute(create);
    assert.deepEqual(replay, first);
    assert.equal(
      (
        await store.listPersonalTasks('owner_v1', {
          status: 'all',
          limit: 100,
        })
      ).length,
      1,
    );
    const taskId = first.tasks[0]?.id;
    assert.ok(taskId);

    const completed = await executor.execute({
      principalId: 'owner_v1',
      invocationId: 'invocation_complete',
      startedAt: '2026-08-26T10:02:00.000Z',
      recovery: false,
      arguments: { action: 'complete', taskId },
    });
    assert.equal(completed.tasks[0]?.status, 'completed');

    await assert.rejects(
      executor.execute({
        principalId: 'owner_v1',
        invocationId: 'invocation_stale_reopen',
        startedAt: '2026-08-26T10:01:00.000Z',
        recovery: true,
        arguments: { action: 'reopen', taskId },
      }),
      /superseded/u,
    );
    assert.equal(
      (await store.findPersonalTaskById('owner_v1', taskId))?.status,
      'completed',
    );

    await assert.rejects(
      executor.execute({ ...create, recovery: true }),
      /superseded/u,
    );

    await assert.rejects(
      executor.execute({
        principalId: 'owner_v1',
        invocationId: 'invocation_a_stale_reopen',
        startedAt: '2026-08-26T10:02:00.000Z',
        recovery: true,
        arguments: { action: 'reopen', taskId },
      }),
      /superseded/u,
    );
    assert.equal(
      (await store.findPersonalTaskById('owner_v1', taskId))?.status,
      'completed',
    );
  });

  void it('discloses read-only authority for listing and write authority for mutations', () => {
    const executor = new LocalPersonalTaskActionExecutor(
      new InMemoryOwnerResourceStore(),
    );
    assert.deepEqual(executor.authorityFor({ action: 'list' }).sideEffects, []);
    assert.deepEqual(
      executor.authorityFor({ action: 'create', title: 'Buy milk' })
        .sideEffects,
      ['personal_data_write'],
    );
    assert.equal(executor.destination.dataBoundary, 'owner_controlled');
    assert.equal(executor.maximumAuthority.networkAccess, 'none');
  });
});
