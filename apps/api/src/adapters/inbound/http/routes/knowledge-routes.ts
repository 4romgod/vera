import type { FastifyInstance } from 'fastify';

import type { KnowledgeService } from '../../../../ports/knowledge/knowledge-service.ts';
import {
  CreateKnowledgeSourceRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  KnowledgeListQueryJsonSchema,
  KnowledgeSearchRequestJsonSchema,
  KnowledgeSearchResponseJsonSchema,
  KnowledgeSourceResponseJsonSchema,
  KnowledgeSourcesResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  type CreateKnowledgeSourceRequest,
  type IdempotencyHeaders,
  type KnowledgeListQuery,
  type KnowledgeSearchRequest,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  options: { principalId: string; knowledge: KnowledgeService },
): void {
  app.post<{
    Body: CreateKnowledgeSourceRequest;
    Headers: IdempotencyHeaders;
  }>(
    '/v1/knowledge-sources',
    {
      schema: {
        body: CreateKnowledgeSourceRequestJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: {
          200: KnowledgeSourceResponseJsonSchema,
          201: KnowledgeSourceResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await options.knowledge.add({
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
        title: request.body.title,
        scope: request.body.scope,
        attachmentIds: request.body.attachmentIds,
        ...(request.body.sensitivity === undefined
          ? {}
          : { sensitivity: request.body.sensitivity }),
        ...(request.body.analysisArtifactId === undefined
          ? {}
          : { analysisArtifactId: request.body.analysisArtifactId }),
      });
      return reply
        .status(result.created ? 201 : 200)
        .header('location', `/v1/knowledge-sources/${result.source.id}`)
        .send(result.source);
    },
  );

  app.get<{ Querystring: KnowledgeListQuery }>(
    '/v1/knowledge-sources',
    {
      schema: {
        querystring: KnowledgeListQueryJsonSchema,
        response: { 200: KnowledgeSourcesResponseJsonSchema },
      },
    },
    async (request) => {
      let scope:
        | { kind: 'global' }
        | { kind: 'project'; projectId: string }
        | undefined;
      if (request.query.scopeKind === 'global') {
        scope = { kind: 'global' };
      } else if (request.query.scopeKind === 'project') {
        if (request.query.projectId === undefined) {
          throw new Error('Validated project scope is missing projectId.');
        }
        scope = { kind: 'project', projectId: request.query.projectId };
      }
      return {
        schemaVersion: 1 as const,
        sources: await options.knowledge.list(options.principalId, {
          status: request.query.status ?? 'active',
          limit: request.query.limit ?? 100,
          ...(scope === undefined ? {} : { scope }),
        }),
      };
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/knowledge-sources/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: KnowledgeSourceResponseJsonSchema },
      },
    },
    (request) => options.knowledge.get(options.principalId, request.params.id),
  );

  app.delete<{ Params: ResourceIdParams }>(
    '/v1/knowledge-sources/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: KnowledgeSourceResponseJsonSchema },
      },
    },
    (request) =>
      options.knowledge.remove(options.principalId, request.params.id),
  );

  app.post<{ Body: KnowledgeSearchRequest }>(
    '/v1/knowledge-search',
    {
      schema: {
        body: KnowledgeSearchRequestJsonSchema,
        response: { 200: KnowledgeSearchResponseJsonSchema },
      },
    },
    (request) =>
      options.knowledge.search({
        principalId: options.principalId,
        query: request.body.query,
        ...(request.body.scope === undefined
          ? {}
          : { scope: request.body.scope }),
        ...(request.body.limit === undefined
          ? {}
          : { limit: request.body.limit }),
      }),
  );
}
