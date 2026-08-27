import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import type { MachineService } from '../../../../application/machines/machine-service.ts';
import { PublicMachineCatalogSchema } from '../../../../domain/machines/machine.ts';

export function registerMachineRoutes(
  app: FastifyInstance,
  machines: MachineService,
): void {
  app.get(
    '/v1/machines',
    {
      schema: {
        response: {
          200: z.toJSONSchema(PublicMachineCatalogSchema, {
            target: 'draft-7',
          }),
        },
      },
    },
    () => machines.list(),
  );
}
