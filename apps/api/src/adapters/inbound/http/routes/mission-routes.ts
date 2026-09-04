import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { MissionLifecycle } from '../../../../application/missions/mission-lifecycle.ts';
import {
  MissionPolicySummarySchema,
  MissionProposalArgumentsSchema,
  MissionSchema,
} from '../../../../domain/missions/mission.ts';
import {
  ApprovalDecisionRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type ApprovalDecisionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

const CreateMissionRequestSchema = MissionProposalArgumentsSchema.extend({
  projectId: z.string().startsWith('project_'),
  policyId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/u)
    .max(100),
}).omit({ project: true });

const missionJson = z.toJSONSchema(MissionSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
const createJson = z.toJSONSchema(CreateMissionRequestSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
const listJson = z.toJSONSchema(
  z.object({ schemaVersion: z.literal(1), missions: z.array(MissionSchema) }),
  { target: 'draft-7', unrepresentable: 'throw' },
);
const policyListJson = z.toJSONSchema(
  z.object({
    schemaVersion: z.literal(1),
    policies: z.array(MissionPolicySummarySchema),
  }),
  { target: 'draft-7', unrepresentable: 'throw' },
);

export function registerMissionRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    missions: MissionLifecycle & { wake(): void };
  },
) {
  app.get(
    '/v1/mission-policies',
    { schema: { response: { 200: policyListJson } } },
    async () => ({
      schemaVersion: 1 as const,
      policies: await options.missions.listPolicies(options.principalId),
    }),
  );
  app.get(
    '/v1/missions',
    { schema: { response: { 200: listJson } } },
    async () => ({
      schemaVersion: 1 as const,
      missions: await options.missions.list(options.principalId),
    }),
  );
  app.post<{
    Headers: IdempotencyHeaders;
    Body: z.infer<typeof CreateMissionRequestSchema>;
  }>(
    '/v1/missions',
    {
      schema: {
        headers: IdempotencyHeadersJsonSchema,
        body: createJson,
        response: { 202: missionJson },
      },
    },
    async (request, reply) => {
      const mission = await options.missions.create({
        ...request.body,
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
      });
      return reply
        .status(202)
        .header('location', `/v1/missions/${mission.id}`)
        .send(mission);
    },
  );
  app.get<{ Params: ResourceIdParams }>(
    '/v1/missions/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: missionJson },
      },
    },
    (request) => options.missions.get(options.principalId, request.params.id),
  );
  app.post<{ Params: ResourceIdParams; Body: ApprovalDecisionRequest }>(
    '/v1/missions/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: missionJson },
      },
    },
    async (request, reply) => {
      const mission = await options.missions.decideApproval({
        principalId: options.principalId,
        missionId: request.params.id,
        decision: request.body.decision,
      });
      options.missions.wake();
      return reply.status(202).send(mission);
    },
  );
  app.post<{ Params: ResourceIdParams }>(
    '/v1/missions/:id/cancellation',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: missionJson },
      },
    },
    async (request, reply) => {
      const mission = await options.missions.cancel({
        principalId: options.principalId,
        missionId: request.params.id,
      });
      options.missions.wake();
      return reply.status(202).send(mission);
    },
  );
}
