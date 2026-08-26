import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VeraInboxReminderDelivery } from '../../../src/adapters/outbound/notifications/vera-inbox-reminder-delivery.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createReminderWorker } from '../../../src/application/reminders/reminder-worker.ts';
import type { Reminder } from '../../../src/domain/reminders/reminder.ts';
import { reminderMutationOrderKey } from '../../../src/ports/persistence/reminder-store.ts';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  const createdAt = '2026-08-26T10:00:00.000Z';
  return {
    schemaVersion: 1,
    id: 'reminder_worker_test',
    principalId: 'owner_v1',
    message: 'Stand up and stretch',
    scheduledFor: '2026-08-26T10:01:00.000Z',
    timeZone: 'Africa/Johannesburg',
    status: 'scheduled',
    createdAt,
    updatedAt: createdAt,
    creationInvocationId: 'invocation_worker_test',
    lastMutation: {
      invocationId: 'invocation_worker_test',
      orderKey: reminderMutationOrderKey(createdAt, 'invocation_worker_test'),
    },
    ...overrides,
  };
}

void describe('reminder worker', () => {
  void it('waits until a reminder is due and emits one durable notification', async () => {
    const store = new InMemoryOwnerResourceStore();
    await store.createReminder(reminder());
    let now = new Date('2026-08-26T10:00:59.000Z');
    const worker = createReminderWorker({
      workerId: 'reminder_worker_first',
      store,
      delivery: new VeraInboxReminderDelivery(store),
      concurrency: 2,
      pollIntervalMs: 25,
      leaseMs: 1_000,
      clock: () => now,
      createToken: () => 'token_first',
    });

    assert.equal(await worker.runOnce(), 0);
    now = new Date('2026-08-26T10:01:00.000Z');
    assert.equal(await worker.runOnce(), 1);
    assert.equal(await worker.runOnce(), 0);
    const notifications = await store.listNotifications('owner_v1', {
      limit: 10,
    });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.message, 'Stand up and stretch');
    assert.equal(
      (await store.findReminderById('owner_v1', 'reminder_worker_test'))
        ?.status,
      'delivered',
    );
  });

  void it('does not let a stale claim deliver after a reschedule', async () => {
    const store = new InMemoryOwnerResourceStore();
    await store.createReminder(reminder());
    const claimed = await store.claimDueReminder({
      workerId: 'reminder_worker_stale',
      token: 'token_stale',
      now: '2026-08-26T10:01:00.000Z',
      expiresAt: '2026-08-26T10:02:00.000Z',
    });
    assert.ok(claimed);
    await store.mutateReminder({
      principalId: 'owner_v1',
      reminderId: claimed.id,
      action: {
        action: 'reschedule',
        reminderId: claimed.id,
        scheduledFor: '2026-08-26T12:00:00.000Z',
        timeZone: 'Africa/Johannesburg',
      },
      invocationId: 'invocation_reschedule',
      mutationAt: '2026-08-26T10:01:30.000Z',
      recovery: false,
    });

    assert.equal(
      await new VeraInboxReminderDelivery(store).deliver({
        reminder: claimed,
        workerId: 'reminder_worker_stale',
        token: 'token_stale',
        deliveredAt: '2026-08-26T10:01:31.000Z',
      }),
      null,
    );
    assert.equal(
      (await store.findReminderById('owner_v1', claimed.id))?.status,
      'scheduled',
    );
  });

  void it('reclaims an expired delivery lease after a worker disappears', async () => {
    const store = new InMemoryOwnerResourceStore();
    await store.createReminder(reminder());
    assert.ok(
      await store.claimDueReminder({
        workerId: 'reminder_worker_gone',
        token: 'token_gone',
        now: '2026-08-26T10:01:00.000Z',
        expiresAt: '2026-08-26T10:01:30.000Z',
      }),
    );
    const worker = createReminderWorker({
      workerId: 'reminder_worker_recovery',
      store,
      delivery: new VeraInboxReminderDelivery(store),
      concurrency: 1,
      pollIntervalMs: 25,
      leaseMs: 1_000,
      clock: () => new Date('2026-08-26T10:01:31.000Z'),
      createToken: () => 'token_recovery',
    });

    assert.equal(await worker.runOnce(), 1);
    assert.equal(
      (await store.listNotifications('owner_v1', { limit: 10 })).length,
      1,
    );
  });
});
