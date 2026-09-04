import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { RoutineLifecycle } from '../../../../application/routines/routine-lifecycle.ts';
import {
  RoutineProposalArgumentsSchema,
  RoutineRunSchema,
  RoutineSchema,
} from '../../../../domain/routines/routine.ts';
import {
  ApprovalDecisionRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type ApprovalDecisionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

const routineJson = z.toJSONSchema(RoutineSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
const runJson = z.toJSONSchema(RoutineRunSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
const createJson = z.toJSONSchema(RoutineProposalArgumentsSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
const listJson = z.toJSONSchema(
  z.object({ schemaVersion: z.literal(1), routines: z.array(RoutineSchema) }),
  { target: 'draft-7', unrepresentable: 'throw' },
);
const runListJson = z.toJSONSchema(
  z.object({ schemaVersion: z.literal(1), runs: z.array(RoutineRunSchema) }),
  { target: 'draft-7', unrepresentable: 'throw' },
);

export function registerRoutineRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    routines: RoutineLifecycle & { wake(): void };
  },
) {
  app.get(
    '/v1/routines',
    { schema: { response: { 200: listJson } } },
    async () => ({
      schemaVersion: 1 as const,
      routines: await options.routines.list(options.principalId),
    }),
  );
  app.post<{
    Headers: IdempotencyHeaders;
    Body: z.infer<typeof RoutineProposalArgumentsSchema>;
  }>(
    '/v1/routines',
    {
      schema: {
        headers: IdempotencyHeadersJsonSchema,
        body: createJson,
        response: { 202: routineJson },
      },
    },
    async (request, reply) => {
      const routine = await options.routines.create({
        ...request.body,
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
      });
      return reply
        .status(202)
        .header('location', `/v1/routines/${routine.id}`)
        .send(routine);
    },
  );
  app.get<{ Params: ResourceIdParams }>(
    '/v1/routines/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: routineJson },
      },
    },
    (request) => options.routines.get(options.principalId, request.params.id),
  );
  app.get<{ Params: ResourceIdParams }>(
    '/v1/routines/:id/runs',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: runListJson },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      runs: await options.routines.listRuns(
        options.principalId,
        request.params.id,
      ),
    }),
  );
  app.get<{ Params: ResourceIdParams }>(
    '/v1/routine-runs/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: runJson },
      },
    },
    (request) =>
      options.routines.getRun(options.principalId, request.params.id),
  );
  app.post<{ Params: ResourceIdParams; Body: ApprovalDecisionRequest }>(
    '/v1/routines/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: routineJson },
      },
    },
    async (request, reply) => {
      const routine = await options.routines.decideApproval({
        principalId: options.principalId,
        routineId: request.params.id,
        decision: request.body.decision,
      });
      options.routines.wake();
      return reply.status(202).send(routine);
    },
  );
  app.post<{ Params: ResourceIdParams }>(
    '/v1/routines/:id/pause',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: routineJson },
      },
    },
    async (request, reply) =>
      reply
        .status(202)
        .send(
          await options.routines.pause(options.principalId, request.params.id),
        ),
  );
  app.post<{ Params: ResourceIdParams }>(
    '/v1/routines/:id/resume',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: routineJson },
      },
    },
    async (request, reply) => {
      const routine = await options.routines.resume(
        options.principalId,
        request.params.id,
      );
      options.routines.wake();
      return reply.status(202).send(routine);
    },
  );
  app.post<{ Params: ResourceIdParams; Headers: IdempotencyHeaders }>(
    '/v1/routines/:id/runs',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 202: runJson },
      },
    },
    async (request, reply) => {
      const run = await options.routines.runNow({
        principalId: options.principalId,
        routineId: request.params.id,
        requestKey: request.headers['idempotency-key'],
      });
      options.routines.wake();
      return reply
        .status(202)
        .header('location', `/v1/routines/${request.params.id}/runs`)
        .send(run);
    },
  );
}
