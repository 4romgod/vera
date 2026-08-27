import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cors from '@fastify/cors';

import type { SoftwareChangeApplicationLifecycle } from '../../../application/change-applications/software-change-application-lifecycle.ts';
import { ChangeApplicationError } from '../../../application/change-applications/software-change-application-lifecycle.ts';
import {
  SoftwareChangePublicationError,
  type SoftwareChangePublicationLifecycle,
} from '../../../application/change-applications/software-change-publication-lifecycle.ts';
import type { ArtifactService } from '../../../application/artifacts/artifact-service.ts';
import type { ConversationService } from '../../../application/conversations/conversation-service.ts';
import type { EvaluateModelDecision } from '../../../application/model-decisions/evaluate-model-decision.ts';
import type { ProjectService } from '../../../application/projects/project-service.ts';
import type { CapabilityService } from '../../../application/capabilities/capability-service.ts';
import type { PersonalTaskService } from '../../../application/personal-tasks/personal-task-service.ts';
import type { ReminderService } from '../../../application/reminders/reminder-service.ts';
import type { NotificationService } from '../../../application/reminders/notification-service.ts';
import type { MemoryService } from '../../../application/memories/memory-service.ts';
import { ResourceError } from '../../../application/shared/resource-error.ts';
import {
  TranscriptionRequestError,
  type TranscriptionService,
} from '../../../application/transcriptions/transcription-service.ts';
import {
  LifecycleError,
  type TaskLifecycle,
} from '../../../application/tasks/task-lifecycle.ts';
import { DecisionResultJsonSchema } from '../../../domain/model/execution-decision.ts';
import { ChangeApplicationExecutionError } from '../../../ports/change-applications/software-change-application-executor.ts';
import { SoftwareChangePublicationExecutionError } from '../../../ports/change-applications/software-change-publication-executor.ts';
import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderErrorCode,
} from '../../../ports/model/model-provider.ts';
import {
  SpeechTranscriptionProviderError,
  type SpeechTranscriptionErrorCode,
} from '../../../ports/transcription/speech-transcription-provider.ts';
import { registerArtifactRoutes } from './routes/artifact-routes.ts';
import { registerChangeApplicationRoutes } from './routes/change-application-routes.ts';
import { registerSoftwareChangePublicationRoutes } from './routes/software-change-publication-routes.ts';
import { registerConversationRoutes } from './routes/conversation-routes.ts';
import { registerProjectRoutes } from './routes/project-routes.ts';
import { registerTaskRoutes } from './routes/task-routes.ts';
import { registerCapabilityRoutes } from './routes/capability-routes.ts';
import { registerPersonalTaskRoutes } from './routes/personal-task-routes.ts';
import { registerReminderRoutes } from './routes/reminder-routes.ts';
import { registerNotificationRoutes } from './routes/notification-routes.ts';
import { registerMemoryRoutes } from './routes/memory-routes.ts';
import { registerTranscriptionRoutes } from './routes/transcription-routes.ts';
import {
  EvaluateRequestJsonSchema,
  HealthResponseJsonSchema,
  NotReadyResponseJsonSchema,
  ReadyResponseJsonSchema,
  type EvaluateRequest,
} from './schemas.ts';

export type BuildAppOptions = {
  evaluateModelDecision: EvaluateModelDecision;
  provider: ModelProvider;
  taskLifecycle?: TaskLifecycle;
  artifacts?: ArtifactService;
  conversations?: ConversationService;
  projects?: ProjectService;
  capabilities?: CapabilityService;
  personalTasks?: PersonalTaskService;
  reminders?: ReminderService;
  notifications?: NotificationService;
  memories?: MemoryService;
  transcriptions?: TranscriptionService;
  changeApplications?: SoftwareChangeApplicationLifecycle & {
    wake(): void;
  };
  softwareChangePublications?: SoftwareChangePublicationLifecycle & {
    wake(): void;
  };
  readinessChecks?: {
    name: string;
    check(): Promise<void>;
  }[];
  close?: () => Promise<void>;
  logger?: FastifyServerOptions['logger'];
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

const LoopbackWebOrigin =
  /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/u;

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

function transcriptionFailureStatus(
  code: SpeechTranscriptionErrorCode,
): 502 | 503 | 504 {
  switch (code) {
    case 'transcription_timeout':
      return 504;
    case 'transcription_not_configured':
    case 'transcription_unavailable':
      return 503;
    case 'transcription_rejected':
    case 'transcription_response_invalid':
      return 502;
  }
}

function publicTranscriptionMessage(code: SpeechTranscriptionErrorCode) {
  switch (code) {
    case 'transcription_not_configured':
      return 'Voice transcription is not configured on this Vera server.';
    case 'transcription_rejected':
      return 'The transcription provider rejected the recording.';
    case 'transcription_response_invalid':
      return 'The transcription provider returned an invalid response.';
    case 'transcription_timeout':
      return 'Voice transcription timed out.';
    case 'transcription_unavailable':
      return 'The transcription provider is unavailable.';
  }
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  // Authentication is deliberately not exposed yet. Keeping the principal at
  // the HTTP boundary ensures stores and domain contracts are already scoped
  // correctly when authentication replaces this owner identity.
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

  // The API remains bound to loopback. This policy only lets a browser-based
  // local Vera frontend read it from a different development port. Requests
  // without an Origin header (native clients, CLI, and curl) are unaffected.
  void app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || LoopbackWebOrigin.test(origin));
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
                  : error.dependency.endsWith('_capability')
                    ? 'capability_unavailable'
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

        if (!(error instanceof ModelProviderError)) throw error;
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
        response: { 200: DecisionResultJsonSchema },
      },
    },
    async (request) => options.evaluateModelDecision(request.body.message),
  );

  if (options.capabilities !== undefined) {
    registerCapabilityRoutes(app, options.capabilities);
  }

  if (options.projects !== undefined) {
    registerProjectRoutes(app, { principalId, projects: options.projects });
  }
  if (options.conversations !== undefined) {
    registerConversationRoutes(app, {
      principalId,
      conversations: options.conversations,
      ...(options.taskLifecycle === undefined
        ? {}
        : { taskLifecycle: options.taskLifecycle }),
    });
  }
  if (options.artifacts !== undefined) {
    registerArtifactRoutes(app, { principalId, artifacts: options.artifacts });
  }
  if (options.personalTasks !== undefined) {
    registerPersonalTaskRoutes(app, {
      principalId,
      personalTasks: options.personalTasks,
    });
  }
  if (options.reminders !== undefined) {
    registerReminderRoutes(app, {
      principalId,
      reminders: options.reminders,
    });
  }
  if (options.notifications !== undefined) {
    registerNotificationRoutes(app, {
      principalId,
      notifications: options.notifications,
    });
  }
  if (options.memories !== undefined) {
    registerMemoryRoutes(app, {
      principalId,
      memories: options.memories,
    });
  }
  if (options.transcriptions !== undefined) {
    registerTranscriptionRoutes(app, options.transcriptions);
  }
  if (options.taskLifecycle !== undefined) {
    registerTaskRoutes(app, {
      principalId,
      taskLifecycle: options.taskLifecycle,
    });
  }
  if (options.changeApplications !== undefined) {
    registerChangeApplicationRoutes(app, {
      principalId,
      changeApplications: options.changeApplications,
    });
  }
  if (options.softwareChangePublications !== undefined) {
    registerSoftwareChangePublicationRoutes(app, {
      principalId,
      publications: options.softwareChangePublications,
    });
  }

  if (options.close !== undefined) app.addHook('onClose', options.close);

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
          : error.code === 'invalid_notification_cursor'
            ? 400
            : error.code === 'invalid_project_source'
              ? 422
              : 404;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof ChangeApplicationError) {
      const statusCode =
        error.code === 'change_application_idempotency_key_reused' ||
        error.code === 'change_application_approval_already_decided' ||
        error.code === 'change_application_concurrent_transition_failed' ||
        error.code === 'change_application_not_cancellable'
          ? 409
          : error.code === 'software_change_artifact_required'
            ? 422
            : 404;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof ChangeApplicationExecutionError) {
      const statusCode = error.code === 'application_failed' ? 500 : 409;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof SoftwareChangePublicationError) {
      const statusCode =
        error.code === 'software_change_publication_source_required'
          ? 422
          : error.code === 'software_change_publication_not_found'
            ? 404
            : 409;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof SoftwareChangePublicationExecutionError) {
      const statusCode =
        error.code === 'publication_unavailable'
          ? 503
          : error.code === 'publication_failed'
            ? 500
            : 409;
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
    if (error instanceof TranscriptionRequestError) {
      const statusCode = error.code === 'audio_too_large' ? 413 : 422;
      void reply.status(statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof SpeechTranscriptionProviderError) {
      request.log.error(
        { err: error, errorCode: error.code },
        'Speech transcription provider request failed',
      );
      void reply.status(transcriptionFailureStatus(error.code)).send({
        error: {
          code: error.code,
          message: publicTranscriptionMessage(error.code),
        },
      });
      return;
    }
    if (
      request.url === '/v1/audio/transcriptions' &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
    ) {
      void reply.status(415).send({
        error: {
          code: 'audio_type_unsupported',
          message: 'The uploaded audio type is not supported.',
        },
      });
      return;
    }
    if (
      request.url === '/v1/audio/transcriptions' &&
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 413
    ) {
      void reply.status(413).send({
        error: {
          code: 'audio_too_large',
          message: "The audio recording exceeds Vera's upload limit.",
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
