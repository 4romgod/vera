import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import type { IntegrationConnectionService } from '../../../../application/integrations/integration-connection-service.ts';
import {
  IntegrationCatalogSchema,
  IntegrationConnectionListSchema,
  PublicIntegrationConnectionSchema,
} from '../../../../domain/integrations/integration-connection.ts';
import {
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

const ConnectIntegrationRequestSchema = z
  .object({
    integrationId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/u)
      .max(100),
  })
  .strict();
const ConnectIntegrationRequestJsonSchema = z.toJSONSchema(
  ConnectIntegrationRequestSchema,
  { target: 'draft-7' },
);
const PublicIntegrationConnectionJsonSchema = z.toJSONSchema(
  PublicIntegrationConnectionSchema,
  { target: 'draft-7' },
);

export function registerIntegrationConnectionRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    integrations: IntegrationConnectionService;
  },
): void {
  app.get(
    '/v1/integrations',
    {
      schema: {
        response: {
          200: z.toJSONSchema(IntegrationCatalogSchema, { target: 'draft-7' }),
        },
      },
    },
    () => options.integrations.catalog(),
  );

  app.get(
    '/v1/integration-connections',
    {
      schema: {
        response: {
          200: z.toJSONSchema(IntegrationConnectionListSchema, {
            target: 'draft-7',
          }),
        },
      },
    },
    async () => ({
      schemaVersion: 1 as const,
      connections: await options.integrations.list(options.principalId),
    }),
  );

  app.post<{
    Body: z.infer<typeof ConnectIntegrationRequestSchema>;
    Headers: IdempotencyHeaders;
  }>(
    '/v1/integration-connections',
    {
      schema: {
        body: ConnectIntegrationRequestJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 201: PublicIntegrationConnectionJsonSchema },
      },
    },
    async (request, reply) => {
      const connection = await options.integrations.connect({
        principalId: options.principalId,
        integrationId: request.body.integrationId,
        requestKey: request.headers['idempotency-key'],
      });
      return reply
        .status(201)
        .header('location', `/v1/integration-connections/${connection.id}`)
        .send(connection);
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/integration-connections/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: PublicIntegrationConnectionJsonSchema },
      },
    },
    async (request) =>
      options.integrations.get(options.principalId, request.params.id),
  );

  app.post<{ Params: ResourceIdParams }>(
    '/v1/integration-connections/:id/verification',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: PublicIntegrationConnectionJsonSchema },
      },
    },
    async (request) =>
      options.integrations.verify(options.principalId, request.params.id),
  );

  app.post<{ Params: ResourceIdParams }>(
    '/v1/integration-connections/:id/revocation',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: PublicIntegrationConnectionJsonSchema },
      },
    },
    async (request) =>
      options.integrations.revoke(options.principalId, request.params.id),
  );
}
