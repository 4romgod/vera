import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryPushNotificationStore } from '../../src/adapters/outbound/persistence/memory/in-memory-push-notification-store.ts';
import { DeterministicPushNotificationProvider } from '../../src/adapters/outbound/notifications/deterministic-push-notification-provider.ts';
import {
  createPushNotificationService,
  nextAllowedTime,
} from '../../src/application/notifications/push-notification-service.ts';
import { createPushNotificationWorker } from '../../src/application/notifications/push-notification-worker.ts';
import { InMemoryWorkLeaseStore } from '../../src/adapters/outbound/persistence/memory/in-memory-work-lease-store.ts';
import type { AttentionBriefing } from '../../src/domain/attention/attention.ts';
import type { PushDelivery } from '../../src/domain/notifications/push-notification.ts';

class StrictInMemoryPushNotificationStore extends InMemoryPushNotificationStore {
  override replaceDelivery(delivery: PushDelivery, expectedVersion: number) {
    assert.equal(
      Object.values(delivery).includes(undefined),
      false,
      'MongoDB-bound deliveries must omit undefined optional fields.',
    );
    return super.replaceDelivery(delivery, expectedVersion);
  }
}

const now = new Date('2026-09-04T10:00:00.000Z');
const attention = {
  getBriefing: (): Promise<AttentionBriefing> =>
    Promise.resolve({
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      headline: 'One thing needs your attention',
      summary: 'Approval waiting.',
      counts: { urgent: 1, high: 0, normal: 0, snoozed: 0, dismissed: 0 },
      items: [
        {
          schemaVersion: 1,
          id: 'attention_0123456789abcdef0123456789abcdef',
          reason: 'approval_required',
          priority: 'urgent',
          title: 'Private project title',
          summary: 'Private request details',
          occurredAt: now.toISOString(),
          target: { kind: 'task', taskId: 'task_one', runId: 'run_one' },
          state: 'active',
        },
      ],
      snoozedItems: [],
      dismissedItems: [],
    }),
  decide: () => Promise.reject(new Error('unused')),
};

void test('materializes once and delivers only a privacy-safe payload', async () => {
  const store = new StrictInMemoryPushNotificationStore();
  const provider = new DeterministicPushNotificationProvider();
  const service = createPushNotificationService({
    store,
    attention,
    provider,
    projectId: 'project-one',
    clock: () => now,
  });
  const device = await service.register('owner_v1', {
    installationId: 'installation-one',
    provider: 'expo',
    projectId: 'project-one',
    pushToken: 'ExpoPushToken[secret-token]',
    platform: 'ios',
    name: 'Phone',
  });
  assert.equal('pushToken' in device, false);
  await service.materialize();
  await service.materialize();
  assert.equal(
    (await service.listDeliveries('owner_v1', 20)).deliveries.length,
    1,
  );
  const worker = createPushNotificationWorker({
    store,
    service,
    provider,
    leases: new InMemoryWorkLeaseStore(),
    pollIntervalMs: 60_000,
    receiptDelayMs: 60_000,
    maxAttempts: 3,
    leaseMs: 60_000,
    clock: () => now,
  });
  await worker.runOnce();
  await worker.stop();
  assert.equal(provider.messages.length, 1);
  assert.deepEqual(provider.messages[0], {
    token: 'ExpoPushToken[secret-token]',
    title: 'Vera needs your attention',
    body: 'An approval is waiting for you.',
    data: {
      deepLink: 'vera://attention/attention_0123456789abcdef0123456789abcdef',
      deliveryId: (await service.listDeliveries('owner_v1', 20)).deliveries[0]
        ?.id,
    },
  });
  assert.equal(JSON.stringify(provider.messages[0]).includes('Private'), false);
});

void test('sends an explicit setup test when result alerts are disabled', async () => {
  const store = new InMemoryPushNotificationStore();
  const provider = new DeterministicPushNotificationProvider();
  const service = createPushNotificationService({
    store,
    attention,
    provider,
    projectId: 'project-one',
    clock: () => now,
  });
  const registered = await service.register('owner_v1', {
    installationId: 'installation-one',
    provider: 'expo',
    projectId: 'project-one',
    pushToken: 'ExpoPushToken[secret-token]',
    platform: 'ios',
    name: 'Phone',
  });
  await service.updatePreferences('owner_v1', registered.id, {
    ...registered.preferences,
    results: false,
  });
  await service.test('owner_v1', registered.id, 'test-request-one');
  const worker = createPushNotificationWorker({
    store,
    service,
    provider,
    leases: new InMemoryWorkLeaseStore(),
    pollIntervalMs: 60_000,
    receiptDelayMs: 60_000,
    maxAttempts: 3,
    leaseMs: 60_000,
    clock: () => now,
  });
  await worker.runOnce();
  await worker.stop();
  assert.equal(
    provider.messages.some(
      (message) => message.body === 'Device notifications are working.',
    ),
    true,
  );
});

void test('does not backfill attention older than device registration', async () => {
  const store = new InMemoryPushNotificationStore();
  const oldAttention = {
    ...attention,
    getBriefing: async () => {
      const current = await attention.getBriefing();
      const first = current.items[0];
      if (first === undefined)
        throw new Error('Fixture attention item is missing.');
      return {
        ...current,
        items: [
          {
            ...first,
            occurredAt: '2026-09-03T10:00:00.000Z',
          },
        ],
      };
    },
  };
  const service = createPushNotificationService({
    store,
    attention: oldAttention,
    provider: new DeterministicPushNotificationProvider(),
    projectId: 'project-one',
    clock: () => now,
  });
  await service.register('owner_v1', {
    installationId: 'installation-one',
    provider: 'expo',
    projectId: 'project-one',
    pushToken: 'ExpoPushToken[secret-token]',
    platform: 'ios',
    name: 'Phone',
  });
  await service.materialize();
  assert.equal(
    (await service.listDeliveries('owner_v1', 20)).deliveries.length,
    0,
  );
});

void test('quiet hours defer across midnight in the owner-selected time zone', () => {
  assert.equal(
    nextAllowedTime(new Date('2026-09-04T20:30:00.000Z'), {
      approvals: true,
      reminders: true,
      tasks: true,
      failures: true,
      results: true,
      quietHours: {
        timeZone: 'Africa/Johannesburg',
        startLocalTime: '22:00',
        endLocalTime: '07:00',
      },
    }),
    '2026-09-05T05:00:00.000Z',
  );
});

void test('rechecks quiet hours at dispatch after preferences change', async () => {
  const store = new InMemoryPushNotificationStore();
  const provider = new DeterministicPushNotificationProvider();
  let current = new Date('2026-09-04T09:00:00.000Z');
  const service = createPushNotificationService({
    store,
    attention,
    provider,
    projectId: 'project-one',
    clock: () => current,
  });
  const device = await service.register('owner_v1', {
    installationId: 'installation-one',
    provider: 'expo',
    projectId: 'project-one',
    pushToken: 'ExpoPushToken[secret-token]',
    platform: 'ios',
    name: 'Phone',
  });
  current = new Date('2026-09-04T20:30:00.000Z');
  await service.materialize();
  await service.updatePreferences('owner_v1', device.id, {
    ...device.preferences,
    quietHours: {
      timeZone: 'Africa/Johannesburg',
      startLocalTime: '22:00',
      endLocalTime: '07:00',
    },
  });
  const worker = createPushNotificationWorker({
    store,
    service,
    provider,
    leases: new InMemoryWorkLeaseStore(),
    pollIntervalMs: 60_000,
    receiptDelayMs: 60_000,
    maxAttempts: 3,
    leaseMs: 60_000,
    clock: () => current,
  });
  await worker.runOnce();
  await worker.stop();
  assert.equal(provider.messages.length, 0);
  const delivery = (await service.listDeliveries('owner_v1', 20)).deliveries[0];
  assert.equal(delivery?.status, 'queued');
  assert.equal(delivery.nextAttemptAt, '2026-09-05T05:00:00.000Z');
});
