import type { FastifyInstance, FastifySchema } from 'fastify';

import { ErrorResponseJsonSchema } from './schemas.ts';

/** Adds the public error envelope as the runtime fallback response contract. */
export function registerErrorResponseValidation(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const schema: FastifySchema = route.schema ?? {};
    const responses =
      typeof schema.response === 'object' && schema.response !== null
        ? (schema.response as Record<string, unknown>)
        : {};
    schema.response = {
      default: ErrorResponseJsonSchema,
      ...responses,
    };
    route.schema = schema;
  });
}
