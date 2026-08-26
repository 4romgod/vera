import type { FastifyInstance } from 'fastify';

import type { CapabilityService } from '../../../../application/capabilities/capability-service.ts';
import { CapabilityCatalogJsonSchema } from '../schemas.ts';

export function registerCapabilityRoutes(
  app: FastifyInstance,
  capabilities: CapabilityService,
): void {
  app.get(
    '/v1/capabilities',
    { schema: { response: { 200: CapabilityCatalogJsonSchema } } },
    async (_request, reply) => reply.code(200).send(capabilities.list()),
  );
}
