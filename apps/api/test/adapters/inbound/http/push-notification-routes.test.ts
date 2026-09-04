import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

import { registerPushNotificationRoutes } from '../../../../src/adapters/inbound/http/routes/push-notification-routes.ts';
import { InMemoryPushNotificationStore } from '../../../../src/adapters/outbound/persistence/memory/in-memory-push-notification-store.ts';
import { DeterministicPushNotificationProvider } from '../../../../src/adapters/outbound/notifications/deterministic-push-notification-provider.ts';
import { createPushNotificationService } from '../../../../src/application/notifications/push-notification-service.ts';

void describe('push-notification HTTP API', () => {
  void it('registers without disclosing the token and queues an idempotent test', async () => {
    const service = createPushNotificationService({
      store: new InMemoryPushNotificationStore(),
      attention: {
        getBriefing: () =>
          Promise.resolve({
            schemaVersion: 1,
            generatedAt: '2026-09-04T00:00:00.000Z',
            headline: 'All caught up',
            summary: 'No attention.',
            counts: {
              urgent: 0,
              high: 0,
              normal: 0,
              snoozed: 0,
              dismissed: 0,
            },
            items: [],
            snoozedItems: [],
            dismissedItems: [],
          }),
        decide: () => Promise.reject(new Error('unused')),
      },
      provider: new DeterministicPushNotificationProvider(),
      projectId: 'project-one',
    });
    const app = Fastify();
    registerPushNotificationRoutes(app, { principalId: 'owner_v1', service });
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/notification-devices',
      payload: {
        installationId: 'installation-one',
        provider: 'expo',
        projectId: 'project-one',
        pushToken: 'ExpoPushToken[private-token]',
        platform: 'android',
        name: 'Phone',
      },
    });
    assert.equal(registration.statusCode, 200);
    assert.equal(registration.body.includes('private-token'), false);
    const device = registration.json<{ id: string }>();
    const first = await app.inject({
      method: 'POST',
      url: `/v1/notification-devices/${device.id}/test`,
      headers: { 'idempotency-key': 'http-test-request' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/notification-devices/${device.id}/test`,
      headers: { 'idempotency-key': 'http-test-request' },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(
      first.json<{ id: string }>().id,
      second.json<{ id: string }>().id,
    );
    await app.close();
  });
});
