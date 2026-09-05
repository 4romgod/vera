import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ExternalSignalSchema } from '../../../../domain/external-awareness/external-signal.ts';
import type { ExternalAwarenessOperations } from '../../../../ports/external-awareness/external-awareness-operations.ts';
import type { RoutineLifecycle } from '../../../../application/routines/routine-lifecycle.ts';
import {
  ResourceIdParamsJsonSchema,
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
