import type { FastifyInstance } from 'fastify';

import type { PersonalTaskService } from '../../../../application/personal-tasks/personal-task-service.ts';
import {
  PersonalTaskListQueryJsonSchema,
  PersonalTaskResponseJsonSchema,
  PersonalTasksResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  type PersonalTaskListQuery,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerPersonalTaskRoutes(
  app: FastifyInstance,
  options: { principalId: string; personalTasks: PersonalTaskService },
): void {
  app.get<{ Querystring: PersonalTaskListQuery }>(
    '/v1/personal-tasks',
    {
      schema: {
        querystring: PersonalTaskListQueryJsonSchema,
        response: { 200: PersonalTasksResponseJsonSchema },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      tasks: await options.personalTasks.list(options.principalId, {
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
    '/v1/personal-tasks/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: PersonalTaskResponseJsonSchema },
      },
    },
    async (request) =>
      options.personalTasks.get(options.principalId, request.params.id),
  );
}
