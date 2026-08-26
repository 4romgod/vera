import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LocalReminderActionExecutor } from '../../../../../src/adapters/outbound/integrations/reminders/local-reminder-action-executor.ts';
import { InMemoryOwnerResourceStore } from '../../../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';

void describe('local reminder integration adapter', () => {
  void it('applies exact reminder actions idempotently and preserves owner scope', async () => {
    const store = new InMemoryOwnerResourceStore();
    const executor = new LocalReminderActionExecutor(store);
    const create = {
      principalId: 'owner_v1',
      invocationId: 'invocation_reminder_create',
      startedAt: '2026-08-26T10:00:00.000Z',
      recovery: false,
      arguments: {
        action: 'create' as const,
        message: 'Call Mum',
        scheduledFor: '2026-08-26T11:00:00.000Z',
        timeZone: 'Africa/Johannesburg',
      },
    };

    const first = await executor.execute(create);
    assert.deepEqual(await executor.execute(create), first);
    const createdReminder = first.reminders[0];
    assert.ok(createdReminder);
    assert.equal(createdReminder.status, 'scheduled');
    const reminderId = createdReminder.id;
    assert.equal(
      (await store.listReminders('someone_else', { status: 'all', limit: 10 }))
        .length,
      0,
    );

    const rescheduled = await executor.execute({
      principalId: 'owner_v1',
      invocationId: 'invocation_reminder_reschedule',
      startedAt: '2026-08-26T10:05:00.000Z',
      recovery: false,
      arguments: {
        action: 'reschedule',
        reminderId,
        scheduledFor: '2026-08-26T12:00:00.000Z',
        timeZone: 'Africa/Johannesburg',
      },
    });
    assert.equal(
      rescheduled.reminders[0]?.scheduledFor,
      '2026-08-26T12:00:00.000Z',
    );

    const cancelled = await executor.execute({
      principalId: 'owner_v1',
      invocationId: 'invocation_reminder_cancel',
      startedAt: '2026-08-26T10:06:00.000Z',
      recovery: false,
      arguments: { action: 'cancel', reminderId },
    });
    assert.equal(cancelled.reminders[0]?.status, 'cancelled');
    assert.equal(
      (
        await executor.execute({
          principalId: 'owner_v1',
          invocationId: 'invocation_reminder_list',
          startedAt: '2026-08-26T10:07:00.000Z',
          recovery: false,
          arguments: { action: 'list', status: 'cancelled' },
        })
      ).reminders.length,
      1,
    );
  });

  void it('discloses scheduling authority and rejects invalid time zones', async () => {
    const executor = new LocalReminderActionExecutor(
      new InMemoryOwnerResourceStore(),
    );
    assert.deepEqual(executor.authorityFor({ action: 'list' }).sideEffects, []);
    assert.deepEqual(
      executor.authorityFor({
        action: 'create',
        message: 'Call Mum',
        scheduledFor: '2026-08-26T11:00:00.000Z',
        timeZone: 'Africa/Johannesburg',
      }).sideEffects,
      ['personal_data_write', 'scheduled_notification'],
    );
    await assert.rejects(
      executor.execute({
        principalId: 'owner_v1',
        invocationId: 'invocation_invalid_zone',
        startedAt: '2026-08-26T10:00:00.000Z',
        recovery: false,
        arguments: {
          action: 'create',
          message: 'Call Mum',
          scheduledFor: '2026-08-26T11:00:00.000Z',
          timeZone: 'Not/AZone',
        },
      }),
      /time zone/u,
    );
  });
});
