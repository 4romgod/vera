import type { FastifyInstance } from 'fastify';

import type { LiveVoiceSessionService } from '../../../../application/voice/live-voice-session-service.ts';
import {
  AcknowledgeSpeechDeliveryRequestJsonSchema,
  CreateLiveVoiceSessionRequestJsonSchema,
  CreateLiveVoiceSessionResponseJsonSchema,
  ErrorResponseJsonSchema,
  IdempotencyHeadersJsonSchema,
  LiveVoiceAvailabilityResponseJsonSchema,
  LiveVoiceSessionResponseJsonSchema,
  LiveVoiceSessionResourceSchema,
  ResourceIdParamsJsonSchema,
  type AcknowledgeSpeechDeliveryRequest,
  type CreateLiveVoiceSessionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

type DeliveryParams = ResourceIdParams & { deliveryId: string };
const DeliveryParamsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'deliveryId'],
  properties: {
    id: { type: 'string', pattern: '^voice_session_' },
    deliveryId: { type: 'string', pattern: '^speech_delivery_' },
  },
} as const;

export function registerLiveVoiceRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    voice: LiveVoiceSessionService;
  },
) {
  app.get(
    '/v1/voice',
    { schema: { response: { 200: LiveVoiceAvailabilityResponseJsonSchema } } },
    () => ({ schemaVersion: 1 as const, enabled: options.voice.enabled }),
  );

  app.post<{
    Body: CreateLiveVoiceSessionRequest;
    Headers: IdempotencyHeaders;
  }>(
    '/v1/voice/sessions',
    {
      schema: {
        body: CreateLiveVoiceSessionRequestJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: {
          201: CreateLiveVoiceSessionResponseJsonSchema,
          409: ErrorResponseJsonSchema,
          503: ErrorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await options.voice.create({
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
        conversationId: request.body.conversationId,
        takeover: request.body.takeover,
        ...(request.body.projectId === undefined
          ? {}
          : { projectId: request.body.projectId }),
      });
      return reply
        .status(201)
        .header('location', `/v1/voice/sessions/${created.session.id}`)
        .send({
          schemaVersion: 1 as const,
          session: LiveVoiceSessionResourceSchema.parse(created.session),
          transport: { kind: 'livekit' as const, ...created.credential },
        });
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/voice/sessions/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: {
          200: LiveVoiceSessionResponseJsonSchema,
          404: ErrorResponseJsonSchema,
        },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      session: LiveVoiceSessionResourceSchema.parse(
        await options.voice.get(options.principalId, request.params.id),
      ),
    }),
  );

  app.delete<{ Params: ResourceIdParams }>(
    '/v1/voice/sessions/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: {
          200: LiveVoiceSessionResponseJsonSchema,
          404: ErrorResponseJsonSchema,
        },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      session: LiveVoiceSessionResourceSchema.parse(
        await options.voice.end(options.principalId, request.params.id),
      ),
    }),
  );

  app.post<{
    Params: DeliveryParams;
    Body: AcknowledgeSpeechDeliveryRequest;
  }>(
    '/v1/voice/sessions/:id/deliveries/:deliveryId/acknowledgement',
    {
      schema: {
        params: DeliveryParamsJsonSchema,
        body: AcknowledgeSpeechDeliveryRequestJsonSchema,
        response: {
          200: LiveVoiceSessionResponseJsonSchema,
          404: ErrorResponseJsonSchema,
          409: ErrorResponseJsonSchema,
        },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      session: LiveVoiceSessionResourceSchema.parse(
        await options.voice.acknowledgeDelivery({
          principalId: options.principalId,
          sessionId: request.params.id,
          deliveryId: request.params.deliveryId,
          outcome: request.body.outcome,
        }),
      ),
    }),
  );
}
