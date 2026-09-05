import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  ExternalSignalJsonSchema,
  ExternalSignalSchema,
} from '../../../../domain/external-awareness/external-signal.ts';
import type { ExternalAwarenessOperations } from '../../../../ports/external-awareness/external-awareness-operations.ts';
import type { RoutineLifecycle } from '../../../../application/routines/routine-lifecycle.ts';
import type { ExternalSignalTriageService } from '../../../../application/external-awareness/external-signal-triage-service.ts';
import { taskResponse } from '../presenters.ts';
import {
  HandleExternalSignalRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  TaskLifecycleResponseJsonSchema,
  type HandleExternalSignalRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

const responseSchema = z.toJSONSchema(
  z
    .object({
      schemaVersion: z.literal(1),
      signals: z.array(ExternalSignalSchema).max(100),
    })
    .strict(),
  { target: 'draft-7', unrepresentable: 'throw' },
);

export function registerExternalAwarenessRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    externalAwareness: ExternalAwarenessOperations;
    routines?: Pick<RoutineLifecycle, 'get'>;
    triage?: ExternalSignalTriageService;
  },
) {
  app.get(
    '/v1/external-signals',
    { schema: { response: { 200: responseSchema } } },
    async () => ({
      schemaVersion: 1 as const,
      signals: await options.externalAwareness.list(options.principalId),
    }),
  );
  app.get<{ Params: ResourceIdParams }>(
    '/v1/external-signals/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: ExternalSignalJsonSchema },
      },
    },
    async (request) =>
      options.externalAwareness.get(options.principalId, request.params.id),
  );
  if (options.triage !== undefined) {
    app.post<{
      Params: ResourceIdParams;
      Body: HandleExternalSignalRequest;
      Headers: IdempotencyHeaders;
    }>(
      '/v1/external-signals/:id/triage',
      {
        schema: {
          params: ResourceIdParamsJsonSchema,
          body: HandleExternalSignalRequestJsonSchema,
          headers: IdempotencyHeadersJsonSchema,
          response: { 202: TaskLifecycleResponseJsonSchema },
        },
      },
      async (request, reply) => {
        const aggregate = await options.triage?.handle({
          principalId: options.principalId,
          signalId: request.params.id,
          requestKey: request.headers['idempotency-key'],
          ...(request.body.objective === undefined
            ? {}
            : { objective: request.body.objective }),
        });
        if (aggregate === undefined)
          throw new Error('External signal triage is not configured.');
        return reply
          .status(202)
          .header('location', `/v1/tasks/${aggregate.task.id}`)
          .send(taskResponse(aggregate));
      },
    );
  }
  app.get<{ Params: ResourceIdParams }>(
    '/v1/routines/:id/external-signals',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: responseSchema },
      },
    },
    async (request) => {
      await options.routines?.get(options.principalId, request.params.id);
      return {
        schemaVersion: 1 as const,
        signals: await options.externalAwareness.listByRoutine(
          options.principalId,
          request.params.id,
        ),
      };
    },
  );
}
