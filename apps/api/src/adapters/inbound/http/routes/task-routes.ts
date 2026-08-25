import type { FastifyInstance } from 'fastify';

import type { TaskLifecycle } from '../../../../application/tasks/task-lifecycle.ts';
import { taskResponse } from '../presenters.ts';
import {
  ApprovalDecisionRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  SubmitTaskRequestJsonSchema,
  TaskEventsResponseJsonSchema,
  TaskLifecycleResponseJsonSchema,
  type ApprovalDecisionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
  type SubmitTaskRequest,
} from '../schemas.ts';

export function registerTaskRoutes(
  app: FastifyInstance,
  options: { principalId: string; taskLifecycle: TaskLifecycle },
): void {
  app.post<{ Body: SubmitTaskRequest; Headers: IdempotencyHeaders }>(
    '/v1/tasks',
    {
      schema: {
        body: SubmitTaskRequestJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 202: TaskLifecycleResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const aggregate = await options.taskLifecycle.submit({
        message: request.body.message,
        requestKey: request.headers['idempotency-key'],
        principalId: options.principalId,
        ...(request.body.projectId === undefined
          ? {}
          : { projectId: request.body.projectId }),
      });
      return reply
        .status(202)
        .header('location', `/v1/tasks/${aggregate.task.id}`)
        .send(taskResponse(aggregate));
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/tasks/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: TaskLifecycleResponseJsonSchema },
      },
    },
    async (request) =>
      taskResponse(
        await options.taskLifecycle.getTask(
          options.principalId,
          request.params.id,
        ),
      ),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/runs/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: TaskLifecycleResponseJsonSchema },
      },
    },
    async (request) =>
      taskResponse(
        await options.taskLifecycle.getRun(
          options.principalId,
          request.params.id,
        ),
      ),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/runs/:id/events',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: TaskEventsResponseJsonSchema },
      },
    },
    async (request) => {
      const aggregate = await options.taskLifecycle.getRun(
        options.principalId,
        request.params.id,
      );
      return {
        schemaVersion: 1 as const,
        taskId: aggregate.task.id,
        runId: aggregate.run.id,
        events: aggregate.events,
      };
    },
  );

  app.post<{ Params: ResourceIdParams; Body: ApprovalDecisionRequest }>(
    '/v1/approvals/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: TaskLifecycleResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const aggregate = await options.taskLifecycle.decideApproval({
        approvalId: request.params.id,
        decision: request.body.decision,
        principalId: options.principalId,
      });
      return reply.status(202).send(taskResponse(aggregate));
    },
  );

  app.post<{ Params: ResourceIdParams }>(
    '/v1/runs/:id/cancellation',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: TaskLifecycleResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const aggregate = await options.taskLifecycle.cancelRun({
        runId: request.params.id,
        principalId: options.principalId,
      });
      return reply.status(202).send(taskResponse(aggregate));
    },
  );
}
