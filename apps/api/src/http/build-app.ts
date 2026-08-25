import Fastify, { type FastifyInstance } from 'fastify';

import type { EvaluateModelDecision } from '../application/evaluate-model-decision.ts';
import {
  ResourceError,
  type ResourceService,
} from '../application/resource-service.ts';
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
  ArtifactResponseJsonSchema,
  ConversationResponseJsonSchema,
  ConversationsResponseJsonSchema,
  CreateConversationMessageRequestJsonSchema,
  CreateConversationRequestJsonSchema,
  HealthResponseJsonSchema,
  IdempotencyHeadersJsonSchema,
  NotReadyResponseJsonSchema,
  ProjectResponseJsonSchema,
  ProjectsResponseJsonSchema,
  RegisterProjectRequestJsonSchema,
  ReadyResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  SubmitTaskRequestJsonSchema,
  TaskEventsResponseJsonSchema,
  TaskLifecycleResponseJsonSchema,
  type ApprovalDecisionRequest,
  type CreateConversationMessageRequest,
  type CreateConversationRequest,
  type EvaluateRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
  type RegisterProjectRequest,
  type SubmitTaskRequest,
} from './schemas.ts';

export type BuildAppOptions = {
  evaluateModelDecision: EvaluateModelDecision;
  provider: ModelProvider;
  taskLifecycle?: TaskLifecycle;
  resources?: ResourceService;
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
    ...(aggregate.task.projectId === undefined
      ? {}
      : { projectId: aggregate.task.projectId }),
    ...(aggregate.task.conversationId === undefined
      ? {}
      : { conversationId: aggregate.task.conversationId }),
    ...(aggregate.task.messageId === undefined
      ? {}
      : { messageId: aggregate.task.messageId }),
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
    ...(aggregate.run.budget === undefined
      ? {}
      : { budget: aggregate.run.budget }),
    ...(aggregate.run.conversationContext === undefined
      ? {}
      : {
          conversationContextManifest:
            aggregate.run.conversationContext.manifest,
        }),
    ...(aggregate.run.conversationReply === undefined
      ? {}
      : {
          conversationReply: {
            status: aggregate.run.conversationReply.status,
            messageId: aggregate.run.conversationReply.messageId,
            createdAt: aggregate.run.conversationReply.createdAt,
            ...(aggregate.run.conversationReply.projectedAt === undefined
              ? {}
              : {
                  projectedAt: aggregate.run.conversationReply.projectedAt,
                }),
          },
        }),
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

function projectResponse(
  project: Awaited<ReturnType<ResourceService['getProject']>>,
) {
  const {
    principalId: ignoredPrincipal,
    registrationKey: ignoredKey,
    ...value
  } = project;
  void ignoredPrincipal;
  void ignoredKey;
  return value;
}

function conversationResponse(
  conversation: Awaited<ReturnType<ResourceService['getConversation']>>,
) {
  const {
    principalId: ignoredPrincipal,
    creationKey: ignoredKey,
    ...value
  } = conversation;
  void ignoredPrincipal;
  void ignoredKey;
  return {
    ...value,
    messages: value.messages.map(
      ({ requestKey: ignoredRequest, ...message }) => {
        void ignoredRequest;
        return message;
      },
    ),
  };
}

function artifactResponse(
  artifact: Awaited<ReturnType<ResourceService['getArtifact']>>,
) {
  const { principalId: ignoredPrincipal, ...value } = artifact;
  void ignoredPrincipal;
  return value;
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
  // Authentication is deliberately not exposed yet. Keeping the principal at
  // the HTTP boundary ensures stores and domain contracts are already scoped
  // correctly when authentication replaces this loopback-only identity.
  const principalId = 'owner_v1';
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
              : error.dependency === 'development_planning_capability'
                ? 'planning_capability_unavailable'
                : error.dependency === 'software_change_capability'
                  ? 'software_change_capability_unavailable'
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

  const resources = options.resources;
  if (resources !== undefined) {
    app.post<{
      Body: RegisterProjectRequest;
      Headers: IdempotencyHeaders;
    }>(
      '/v1/projects',
      {
        schema: {
          body: RegisterProjectRequestJsonSchema,
          headers: IdempotencyHeadersJsonSchema,
          response: { 201: ProjectResponseJsonSchema },
        },
      },
      async (request, reply) => {
        const project = await resources.registerProject({
          principalId,
          registrationKey: request.headers['idempotency-key'],
          displayName: request.body.displayName,
          rootPath: request.body.source.rootPath,
        });
        return reply
          .status(201)
          .header('location', `/v1/projects/${project.id}`)
          .send(projectResponse(project));
      },
    );

    app.get(
      '/v1/projects',
      { schema: { response: { 200: ProjectsResponseJsonSchema } } },
      async () => ({
        schemaVersion: 1 as const,
        projects: (await resources.listProjects(principalId)).map(
          projectResponse,
        ),
      }),
    );

    app.get<{ Params: ResourceIdParams }>(
      '/v1/projects/:id',
      {
        schema: {
          params: ResourceIdParamsJsonSchema,
          response: { 200: ProjectResponseJsonSchema },
        },
      },
      async (request) =>
        projectResponse(
          await resources.getProject(principalId, request.params.id),
        ),
    );

    app.post<{
      Body: CreateConversationRequest;
      Headers: IdempotencyHeaders;
    }>(
      '/v1/conversations',
      {
        schema: {
          body: CreateConversationRequestJsonSchema,
          headers: IdempotencyHeadersJsonSchema,
          response: { 201: ConversationResponseJsonSchema },
        },
      },
      async (request, reply) => {
        const conversation = await resources.createConversation({
          principalId,
          creationKey: request.headers['idempotency-key'],
          ...(request.body.title === undefined
            ? {}
            : { title: request.body.title }),
        });
        return reply
          .status(201)
          .header('location', `/v1/conversations/${conversation.id}`)
          .send(conversationResponse(conversation));
      },
    );

    app.get(
      '/v1/conversations',
      { schema: { response: { 200: ConversationsResponseJsonSchema } } },
      async () => ({
        schemaVersion: 1 as const,
        conversations: await resources.listConversations(principalId),
      }),
    );

    app.get<{ Params: ResourceIdParams }>(
      '/v1/conversations/:id',
      {
        schema: {
          params: ResourceIdParamsJsonSchema,
          response: { 200: ConversationResponseJsonSchema },
        },
      },
      async (request) =>
        conversationResponse(
          await resources.getConversation(principalId, request.params.id),
        ),
    );

    app.get<{ Params: ResourceIdParams }>(
      '/v1/artifacts/:id',
      {
        schema: {
          params: ResourceIdParamsJsonSchema,
          response: { 200: ArtifactResponseJsonSchema },
        },
      },
      async (request) =>
        artifactResponse(
          await resources.getArtifact(principalId, request.params.id),
        ),
    );
  }

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
          principalId,
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
          await taskLifecycle.getTask(principalId, request.params.id),
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
          await taskLifecycle.getRun(principalId, request.params.id),
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
        const aggregate = await taskLifecycle.getRun(
          principalId,
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
          principalId,
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
        const aggregate = await taskLifecycle.cancelRun({
          runId: request.params.id,
          principalId,
        });
        return reply.status(202).send(taskResponse(aggregate));
      },
    );

    if (resources !== undefined) {
      app.post<{
        Params: ResourceIdParams;
        Body: CreateConversationMessageRequest;
        Headers: IdempotencyHeaders;
      }>(
        '/v1/conversations/:id/messages',
        {
          schema: {
            params: ResourceIdParamsJsonSchema,
            body: CreateConversationMessageRequestJsonSchema,
            headers: IdempotencyHeadersJsonSchema,
            response: { 202: TaskLifecycleResponseJsonSchema },
          },
        },
        async (request, reply) => {
          const appended = await resources.appendOwnerMessage({
            principalId,
            conversationId: request.params.id,
            requestKey: request.headers['idempotency-key'],
            content: request.body.content,
            ...(request.body.projectId === undefined
              ? {}
              : { projectId: request.body.projectId }),
          });
          const aggregate =
            appended.taskId === undefined
              ? await taskLifecycle.submit({
                  principalId,
                  requestKey: appended.messageId,
                  message: request.body.content,
                  conversationId: request.params.id,
                  messageId: appended.messageId,
                  ...(request.body.projectId === undefined
                    ? {}
                    : { projectId: request.body.projectId }),
                })
              : await taskLifecycle.getTask(principalId, appended.taskId);
          if (appended.taskId === undefined) {
            await resources.attachTask({
              principalId,
              conversationId: request.params.id,
              messageId: appended.messageId,
              taskId: aggregate.task.id,
            });
          }
          return reply
            .status(202)
            .header('location', `/v1/tasks/${aggregate.task.id}`)
            .send(taskResponse(aggregate));
        },
      );
    }
  }

  if (options.close !== undefined) {
    app.addHook('onClose', options.close);
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof LifecycleError) {
      const statusCode =
        error.code === 'approval_already_decided' ||
        error.code === 'idempotency_key_reused' ||
        error.code === 'concurrent_transition_failed' ||
        error.code === 'conversation_message_mismatch'
          ? 409
          : 404;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof ResourceError) {
      const statusCode =
        error.code === 'idempotency_key_reused'
          ? 409
          : error.code === 'invalid_project_source'
            ? 422
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
