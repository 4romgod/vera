import type { FastifyInstance } from 'fastify';

import type { MemoryService } from '../../../../application/memories/memory-service.ts';
import {
  MemoriesResponseJsonSchema,
  MemoryListQueryJsonSchema,
  MemoryResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  type MemoryListQuery,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerMemoryRoutes(
  app: FastifyInstance,
  options: { principalId: string; memories: MemoryService },
): void {
  app.get<{ Querystring: MemoryListQuery }>(
    '/v1/memories',
    {
      schema: {
        querystring: MemoryListQueryJsonSchema,
        response: { 200: MemoriesResponseJsonSchema },
      },
    },
    async (request) => {
      const scope =
        request.query.scopeKind === undefined
          ? undefined
          : request.query.scopeKind === 'global'
            ? ({ kind: 'global' } as const)
            : request.query.projectId === undefined
              ? undefined
              : ({
                  kind: 'project',
                  projectId: request.query.projectId,
                } as const);
      return {
        schemaVersion: 1 as const,
        memories: await options.memories.list(options.principalId, {
          status: request.query.status ?? 'active',
          limit: request.query.limit ?? 50,
          ...(request.query.kind === undefined
            ? {}
            : { kind: request.query.kind }),
          ...(scope === undefined ? {} : { scope }),
        }),
      };
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/memories/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: MemoryResponseJsonSchema },
      },
    },
    async (request) =>
      options.memories.get(options.principalId, request.params.id),
  );
}
