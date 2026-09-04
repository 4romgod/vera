import type { FastifyInstance } from 'fastify';

import type { AttentionService } from '../../../../ports/attention/attention-service.ts';
import {
  AttentionBriefingJsonSchema,
  AttentionDecisionRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type AttentionDecisionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerAttentionRoutes(
  app: FastifyInstance,
  options: { principalId: string; attention: AttentionService },
): void {
  app.get(
    '/v1/attention',
    { schema: { response: { 200: AttentionBriefingJsonSchema } } },
    async () => options.attention.getBriefing(options.principalId),
  );

  app.post<{
    Params: ResourceIdParams;
    Headers: IdempotencyHeaders;
    Body: AttentionDecisionRequest;
  }>(
    '/v1/attention-items/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        body: AttentionDecisionRequestJsonSchema,
        response: { 200: AttentionBriefingJsonSchema },
      },
    },
    async (request) =>
      options.attention.decide({
        principalId: options.principalId,
        attentionItemId: request.params.id,
        requestKey: request.headers['idempotency-key'],
        request: request.body,
      }),
  );
}
