import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import Fastify from 'fastify';

import { registerNotificationRoutes } from '../../../../src/adapters/inbound/http/routes/notification-routes.ts';
import type { NotificationService } from '../../../../src/application/reminders/notification-service.ts';

void describe('notification HTTP stream', () => {
  void it('resumes from Last-Event-ID and closes during server shutdown', async () => {
    const calls: Parameters<NotificationService['list']>[1][] = [];
    const notifications: NotificationService = {
      list(_principalId, options) {
        calls.push(options);
        return Promise.resolve({ schemaVersion: 1, notifications: [] });
      },
    };
    const app = Fastify();
    registerNotificationRoutes(app, {
      principalId: 'owner_v1',
      notifications,
    });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${origin}/v1/notifications/stream`, {
      headers: { 'last-event-id': 'opaque-cursor' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], { after: 'opaque-cursor' });
    const reader = response.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader.read();
    assert.ok(firstChunk.value instanceof Uint8Array);
    assert.match(new TextDecoder().decode(firstChunk.value), /retry: 1000/u);
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Notification stream blocked shutdown.')),
          2_000,
        );
        timeout.unref();
      }),
    ]);
    assert.equal((await reader.read()).done, true);
  });
});
