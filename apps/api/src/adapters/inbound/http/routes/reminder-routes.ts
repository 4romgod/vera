import type { FastifyInstance } from 'fastify';

import type { ReminderService } from '../../../../application/reminders/reminder-service.ts';
import {
  ReminderListQueryJsonSchema,
  ReminderResponseJsonSchema,
  RemindersResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  type ReminderListQuery,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerReminderRoutes(
  app: FastifyInstance,
  options: { principalId: string; reminders: ReminderService },
): void {
  app.get<{ Querystring: ReminderListQuery }>(
    '/v1/reminders',
    {
      schema: {
        querystring: ReminderListQueryJsonSchema,
        response: { 200: RemindersResponseJsonSchema },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      reminders: await options.reminders.list(options.principalId, {
        ...(request.query.status === undefined
          ? {}
          : { status: request.query.status }),
        ...(request.query.limit === undefined
          ? {}
          : { limit: request.query.limit }),
      }),
    }),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/reminders/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: ReminderResponseJsonSchema },
      },
    },
    async (request) =>
      options.reminders.get(options.principalId, request.params.id),
  );
}
