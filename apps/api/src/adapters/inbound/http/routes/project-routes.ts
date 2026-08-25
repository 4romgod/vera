import type { FastifyInstance } from 'fastify';

import type { ProjectService } from '../../../../application/projects/project-service.ts';
import { projectResponse } from '../presenters.ts';
import {
  IdempotencyHeadersJsonSchema,
  ProjectResponseJsonSchema,
  ProjectsResponseJsonSchema,
  RegisterProjectRequestJsonSchema,
  ResourceIdParamsJsonSchema,
  type IdempotencyHeaders,
  type RegisterProjectRequest,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerProjectRoutes(
  app: FastifyInstance,
  options: { principalId: string; projects: ProjectService },
): void {
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
      const project = await options.projects.registerProject({
        principalId: options.principalId,
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
      projects: (await options.projects.listProjects(options.principalId)).map(
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
        await options.projects.getProject(
          options.principalId,
          request.params.id,
        ),
      ),
  );
}
