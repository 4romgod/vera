import type { FastifyInstance } from 'fastify';

import type { ArtifactService } from '../../../../application/artifacts/artifact-service.ts';
import { artifactResponse } from '../presenters.ts';
import {
  ArtifactResponseJsonSchema,
  ResourceIdParamsJsonSchema,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerArtifactRoutes(
  app: FastifyInstance,
  options: { principalId: string; artifacts: ArtifactService },
): void {
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
        await options.artifacts.getArtifact(
          options.principalId,
          request.params.id,
        ),
      ),
  );
}
