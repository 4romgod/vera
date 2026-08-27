import type { FastifyInstance } from 'fastify';

import type { SoftwareChangePublicationLifecycle } from '../../../../application/change-applications/software-change-publication-lifecycle.ts';
import { softwareChangePublicationResponse } from '../presenters.ts';
import {
  ApprovalDecisionRequestJsonSchema,
  CreateSoftwareChangePublicationRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  SoftwareChangePublicationEventsResponseJsonSchema,
  SoftwareChangePublicationResponseJsonSchema,
  type ApprovalDecisionRequest,
  type CreateSoftwareChangePublicationRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerSoftwareChangePublicationRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    publications: SoftwareChangePublicationLifecycle & { wake(): void };
  },
) {
  const publications = options.publications;
  app.post<{
    Params: ResourceIdParams;
    Headers: IdempotencyHeaders;
    Body: CreateSoftwareChangePublicationRequest;
  }>(
    '/v1/change-applications/:id/publications',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        body: CreateSoftwareChangePublicationRequestJsonSchema,
        response: { 202: SoftwareChangePublicationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const publication = await publications.create({
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
        applicationId: request.params.id,
        ...request.body,
      });
      return reply
        .status(202)
        .header(
          'location',
          `/v1/software-change-publications/${publication.id}`,
        )
        .send(softwareChangePublicationResponse(publication));
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/software-change-publications/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: SoftwareChangePublicationResponseJsonSchema },
      },
    },
    async (request) =>
      softwareChangePublicationResponse(
        await publications.get(options.principalId, request.params.id),
      ),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/software-change-publications/:id/events',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: SoftwareChangePublicationEventsResponseJsonSchema },
      },
    },
    async (request) => {
      const publication = await publications.get(
        options.principalId,
        request.params.id,
      );
      return {
        schemaVersion: 1 as const,
        publicationId: publication.id,
        events: publication.events,
      };
    },
  );

  app.post<{ Params: ResourceIdParams; Body: ApprovalDecisionRequest }>(
    '/v1/software-change-publications/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: SoftwareChangePublicationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const publication = await publications.decideApproval({
        principalId: options.principalId,
        publicationId: request.params.id,
        decision: request.body.decision,
      });
      publications.wake();
      return reply
        .status(202)
        .send(softwareChangePublicationResponse(publication));
    },
  );

  app.post<{ Params: ResourceIdParams }>(
    '/v1/software-change-publications/:id/cancellation',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: SoftwareChangePublicationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const publication = await publications.cancel({
        principalId: options.principalId,
        publicationId: request.params.id,
      });
      publications.wake();
      return reply
        .status(202)
        .send(softwareChangePublicationResponse(publication));
    },
  );
}
