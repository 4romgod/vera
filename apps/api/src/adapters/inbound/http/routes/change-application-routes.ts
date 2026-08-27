import type { FastifyInstance } from 'fastify';

import type { SoftwareChangeApplicationLifecycle } from '../../../../application/change-applications/software-change-application-lifecycle.ts';
import { changeApplicationResponse } from '../presenters.ts';
import {
  ApprovalDecisionRequestJsonSchema,
  ChangeApplicationEventsResponseJsonSchema,
  ChangeApplicationListResponseJsonSchema,
  ChangeApplicationResponseJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type ApprovalDecisionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerChangeApplicationRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    changeApplications: SoftwareChangeApplicationLifecycle & { wake(): void };
  },
): void {
  const applications = options.changeApplications;
  app.get<{ Params: ResourceIdParams }>(
    '/v1/artifacts/:id/applications',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: ChangeApplicationListResponseJsonSchema },
      },
    },
    async (request) => ({
      schemaVersion: 1 as const,
      applications: (
        await applications.listForArtifact(
          options.principalId,
          request.params.id,
        )
      ).map(changeApplicationResponse),
    }),
  );

  app.post<{ Params: ResourceIdParams; Headers: IdempotencyHeaders }>(
    '/v1/artifacts/:id/applications',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 202: ChangeApplicationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const application = await applications.create({
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
        artifactId: request.params.id,
      });
      return reply
        .status(202)
        .header('location', `/v1/change-applications/${application.id}`)
        .send(changeApplicationResponse(application));
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/change-applications/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: ChangeApplicationResponseJsonSchema },
      },
    },
    async (request) =>
      changeApplicationResponse(
        await applications.get(options.principalId, request.params.id),
      ),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/change-applications/:id/events',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: ChangeApplicationEventsResponseJsonSchema },
      },
    },
    async (request) => {
      const application = await applications.get(
        options.principalId,
        request.params.id,
      );
      return {
        schemaVersion: 1 as const,
        applicationId: application.id,
        events: application.events,
      };
    },
  );

  app.post<{
    Params: ResourceIdParams;
    Body: ApprovalDecisionRequest;
  }>(
    '/v1/change-applications/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: ChangeApplicationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const application = await applications.decideApproval({
        principalId: options.principalId,
        applicationId: request.params.id,
        decision: request.body.decision,
      });
      applications.wake();
      return reply.status(202).send(changeApplicationResponse(application));
    },
  );

  app.post<{ Params: ResourceIdParams }>(
    '/v1/change-applications/:id/cancellation',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: ChangeApplicationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const application = await applications.cancel({
        principalId: options.principalId,
        applicationId: request.params.id,
      });
      applications.wake();
      return reply.status(202).send(changeApplicationResponse(application));
    },
  );
}
