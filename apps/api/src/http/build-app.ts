import Fastify, { type FastifyInstance } from 'fastify';

import type { EvaluateModelDecision } from '../application/evaluate-model-decision.ts';
import {
  LifecycleError,
  type TaskLifecycle,
} from '../application/task-lifecycle.ts';
import type { TaskAggregate } from '../domain/task-aggregate.ts';
import { DecisionResultJsonSchema } from '../domain/execution-decision.ts';
import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderErrorCode,
} from '../model/model-provider.ts';
import {
  EvaluateRequestJsonSchema,
  ApprovalDecisionRequestJsonSchema,
  HealthResponseJsonSchema,
  IdempotencyHeadersJsonSchema,
  NotReadyResponseJsonSchema,
  ReadyResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  SubmitTaskRequestJsonSchema,
  TaskEventsResponseJsonSchema,
  TaskLifecycleResponseJsonSchema,
  type ApprovalDecisionRequest,
  type EvaluateRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
  type SubmitTaskRequest,
} from './schemas.ts';

export type BuildAppOptions = {
  evaluateModelDecision: EvaluateModelDecision;
  provider: ModelProvider;
  taskLifecycle?: TaskLifecycle;
  readinessChecks?: {
    name: string;
    check(): Promise<void>;
  }[];
  close?: () => Promise<void>;
  logger?: boolean;
};

class DependencyReadinessError extends Error {
  public constructor(
    public readonly dependency: string,
    options: ErrorOptions,
  ) {
    super(`${dependency} is unavailable.`, options);
    this.name = 'DependencyReadinessError';
  }
}

function taskResponse(aggregate: TaskAggregate) {
  return {
    schemaVersion: 1 as const,
    taskId: aggregate.task.id,
    runId: aggregate.run.id,
    taskStatus: aggregate.task.status,
    runStatus: aggregate.run.status,
    message: aggregate.task.message,
    createdAt: aggregate.task.createdAt,
    updatedAt: aggregate.task.updatedAt,
    ...(aggregate.run.decision === undefined
      ? {}
      : { decision: aggregate.run.decision }),
    ...(aggregate.run.approval === undefined
      ? {}
      : { approval: aggregate.run.approval }),
    ...(aggregate.run.invocation === undefined
      ? {}
      : { invocation: aggregate.run.invocation }),
    ...(aggregate.run.output === undefined
      ? {}
      : { output: aggregate.run.output }),
    ...(aggregate.run.failure === undefined
      ? {}
      : { failure: aggregate.run.failure }),
    links: {
      task: `/v1/tasks/${aggregate.task.id}`,
      run: `/v1/runs/${aggregate.run.id}`,
      events: `/v1/runs/${aggregate.run.id}/events`,
      ...(aggregate.run.approval === undefined
        ? {}
        : {
            approval: `/v1/approvals/${aggregate.run.approval.id}/decision`,
          }),
    },
  };
}

function publicProviderMessage(
  code: ModelProviderErrorCode,
  model: string,
): string {
  switch (code) {
    case 'model_not_found':
      return `The configured model "${model}" is not available.`;
    case 'provider_request_rejected':
      return "The model provider rejected Vera's request.";
    case 'provider_response_invalid':
      return 'The model provider returned an invalid response.';
    case 'provider_timeout':
      return 'The model provider timed out.';
    case 'provider_unavailable':
      return 'The model provider is unavailable.';
  }
}

function providerFailureStatus(code: ModelProviderErrorCode): 502 | 503 | 504 {
  switch (code) {
    case 'provider_timeout':
      return 504;
    case 'model_not_found':
    case 'provider_unavailable':
      return 503;
    case 'provider_request_rejected':
    case 'provider_response_invalid':
      return 502;
  }
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 25_000,
    requestIdHeader: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  app.get(
    '/health',
    { schema: { response: { 200: HealthResponseJsonSchema } } },
    () => ({
      status: 'ok',
      service: 'vera-api',
      model: {
        name: options.provider.name,
        model: options.provider.model,
      },
    }),
  );

  app.get(
    '/ready',
    {
      schema: {
        response: {
          200: ReadyResponseJsonSchema,
          503: NotReadyResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const readiness = await options.provider.checkReadiness();
        for (const check of options.readinessChecks ?? []) {
          try {
            await check.check();
          } catch (error) {
            throw new DependencyReadinessError(check.name, { cause: error });
          }
        }
        return {
          status: 'ready',
          service: 'vera-api',
          model: {
            name: readiness.provider,
            model: readiness.model,
            durationMs: readiness.durationMs,
            ...(readiness.providerVersion === undefined
              ? {}
              : { providerVersion: readiness.providerVersion }),
          },
        };
      } catch (error) {
        if (error instanceof DependencyReadinessError) {
          const code =
            error.dependency === 'redis_scratchpad'
              ? 'scratchpad_unavailable'
              : 'operational_store_unavailable';
          request.log.error(
            { err: error, errorCode: code, dependency: error.dependency },
            'Runtime dependency readiness check failed',
          );
          return reply.status(503).send({
            status: 'not_ready',
            service: 'vera-api',
            model: {
              name: options.provider.name,
              model: options.provider.model,
            },
            error: {
              code,
              message: `The ${error.dependency} dependency is unavailable.`,
              dependency: error.dependency,
            },
          });
        }

        if (!(error instanceof ModelProviderError)) {
          throw error;
        }

        request.log.error(
          { err: error, errorCode: error.code },
          'Model provider readiness check failed',
        );
        return reply.status(503).send({
          status: 'not_ready',
          service: 'vera-api',
          model: {
            name: options.provider.name,
            model: options.provider.model,
          },
          error: {
            code: error.code,
            message: publicProviderMessage(error.code, options.provider.model),
          },
        });
      }
    },
  );

  app.post<{ Body: EvaluateRequest }>(
    '/v1/model-decisions',
    {
      schema: {
        body: EvaluateRequestJsonSchema,
        response: {
          200: DecisionResultJsonSchema,
        },
      },
    },
    async (request) => options.evaluateModelDecision(request.body.message),
  );

  const taskLifecycle = options.taskLifecycle;
  if (taskLifecycle !== undefined) {
    app.post<{
      Body: SubmitTaskRequest;
      Headers: IdempotencyHeaders;
    }>(
      '/v1/tasks',
      {
        schema: {
          body: SubmitTaskRequestJsonSchema,
          headers: IdempotencyHeadersJsonSchema,
          response: { 202: TaskLifecycleResponseJsonSchema },
        },
      },
      async (request, reply) => {
        const aggregate = await taskLifecycle.submit({
          message: request.body.message,
          requestKey: request.headers['idempotency-key'],
          principalId: 'owner_v1',
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
        taskResponse(await taskLifecycle.getTask(request.params.id)),
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
        taskResponse(await taskLifecycle.getRun(request.params.id)),
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
        const aggregate = await taskLifecycle.getRun(request.params.id);
        return {
          schemaVersion: 1 as const,
          taskId: aggregate.task.id,
          runId: aggregate.run.id,
          events: aggregate.events,
        };
      },
    );

    app.post<{
      Params: ResourceIdParams;
      Body: ApprovalDecisionRequest;
    }>(
      '/v1/approvals/:id/decision',
      {
        schema: {
          params: ResourceIdParamsJsonSchema,
          body: ApprovalDecisionRequestJsonSchema,
          response: { 202: TaskLifecycleResponseJsonSchema },
        },
      },
      async (request, reply) => {
        const aggregate = await taskLifecycle.decideApproval({
          approvalId: request.params.id,
          decision: request.body.decision,
          principalId: 'owner_v1',
        });
        return reply.status(202).send(taskResponse(aggregate));
      },
    );
  }

  if (options.close !== undefined) {
    app.addHook('onClose', options.close);
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof LifecycleError) {
      const statusCode =
        error.code === 'approval_already_decided' ||
        error.code === 'idempotency_key_reused' ||
        error.code === 'concurrent_transition_failed'
          ? 409
          : 404;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof ModelProviderError) {
      const statusCode = providerFailureStatus(error.code);
      request.log.error(
        { err: error, errorCode: error.code },
        'Model provider request failed',
      );
      void reply.status(statusCode).send({
        error: {
          code: error.code,
          message: publicProviderMessage(error.code, options.provider.model),
        },
      });
      return;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation !== undefined
    ) {
      void reply.status(400).send({
        error: {
          code: 'invalid_request',
          message:
            error instanceof Error
              ? error.message
              : 'Request validation failed.',
        },
      });
      return;
    }

    request.log.error(error);
    void reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      },
    });
  });

  return app;
}
