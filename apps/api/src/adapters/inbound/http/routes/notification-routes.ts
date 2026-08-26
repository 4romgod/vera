import type { ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import type { NotificationService } from '../../../../application/reminders/notification-service.ts';
import { notificationCursor } from '../../../../domain/reminders/reminder.ts';
import {
  NotificationListQueryJsonSchema,
  NotificationsResponseJsonSchema,
  type NotificationListQuery,
} from '../schemas.ts';

const streamPollIntervalMs = 500;
const heartbeatIntervalMs = 15_000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isStreamOpen(stream: ServerResponse): boolean {
  return !stream.destroyed && !stream.writableEnded;
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: { principalId: string; notifications: NotificationService },
): void {
  const activeStreams = new Set<ServerResponse>();
  app.addHook('preClose', async () => {
    for (const stream of activeStreams) stream.end();
    await Promise.resolve();
  });

  app.get<{ Querystring: NotificationListQuery }>(
    '/v1/notifications',
    {
      schema: {
        querystring: NotificationListQueryJsonSchema,
        response: { 200: NotificationsResponseJsonSchema },
      },
    },
    async (request) =>
      options.notifications.list(options.principalId, {
        ...(request.query.after === undefined
          ? {}
          : { after: request.query.after }),
        ...(request.query.limit === undefined
          ? {}
          : { limit: request.query.limit }),
      }),
  );

  app.get<{ Querystring: NotificationListQuery }>(
    '/v1/notifications/stream',
    { schema: { querystring: NotificationListQueryJsonSchema } },
    async (request, reply) => {
      const lastEventId = request.headers['last-event-id'];
      const after =
        request.query.after ??
        (typeof lastEventId === 'string' ? lastEventId : undefined);
      let page = await options.notifications.list(options.principalId, {
        ...(after === undefined ? {} : { after }),
        ...(request.query.limit === undefined
          ? {}
          : { limit: request.query.limit }),
      });
      let cursor = page.nextCursor ?? after;
      let heartbeatAt = Date.now();
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.raw.write('retry: 1000\n\n');
      activeStreams.add(reply.raw);

      try {
        while (isStreamOpen(reply.raw)) {
          for (const notification of page.notifications) {
            const eventCursor = notificationCursor(notification);
            reply.raw.write(
              `event: notification\nid: ${eventCursor}\ndata: ${JSON.stringify(notification)}\n\n`,
            );
            cursor = eventCursor;
          }
          if (page.nextCursor !== undefined) cursor = page.nextCursor;
          if (Date.now() - heartbeatAt >= heartbeatIntervalMs) {
            reply.raw.write(': heartbeat\n\n');
            heartbeatAt = Date.now();
          }
          await wait(streamPollIntervalMs);
          if (!isStreamOpen(reply.raw)) break;
          page = await options.notifications.list(options.principalId, {
            ...(cursor === undefined ? {} : { after: cursor }),
            limit: request.query.limit ?? 100,
          });
        }
      } catch (error) {
        request.log.error(
          { err: error },
          'Notification stream projection failed',
        );
      } finally {
        activeStreams.delete(reply.raw);
        if (isStreamOpen(reply.raw)) reply.raw.end();
      }
    },
  );
}
