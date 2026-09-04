import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { DevelopmentCampaignLifecycle } from '../../../../application/development-campaigns/development-campaign-lifecycle.ts';
import {
  DevelopmentCampaignPolicySummarySchema,
  DevelopmentCampaignSchema,
} from '../../../../domain/development-campaigns/development-campaign.ts';
import {
  ApprovalDecisionRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type ApprovalDecisionRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

const CreateDevelopmentCampaignRequestSchema = z
  .object({
    projectId: z.string().startsWith('project_'),
    policyId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/u)
      .max(100),
    objective: z.string().trim().min(1).max(10_000),
    ticket: z
      .object({
        reference: z.string().trim().min(1).max(200),
        details: z.string().trim().min(1).max(20_000),
      })
      .strict(),
    delivery: z
      .object({
        commitMessage: z.string().trim().min(1).max(5_000),
        pullRequest: z
          .object({
            title: z.string().trim().min(1).max(256),
            body: z.string().max(50_000),
            draft: z.literal(false),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

type CreateDevelopmentCampaignRequest = z.infer<
  typeof CreateDevelopmentCampaignRequestSchema
>;

const CampaignRepairParamsSchema = z
  .object({
    id: z.string().startsWith('campaign_'),
    repairId: z.string().startsWith('repair_'),
  })
  .strict();
type CampaignRepairParams = z.infer<typeof CampaignRepairParamsSchema>;
const CampaignRepairParamsJsonSchema = z.toJSONSchema(
  CampaignRepairParamsSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);

const DevelopmentCampaignListSchema = z
  .object({
    schemaVersion: z.literal(1),
    campaigns: z.array(DevelopmentCampaignSchema).max(50),
  })
  .strict();

const CreateDevelopmentCampaignRequestJsonSchema = z.toJSONSchema(
  CreateDevelopmentCampaignRequestSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);
const DevelopmentCampaignResponseJsonSchema = z.toJSONSchema(
  DevelopmentCampaignSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);
const DevelopmentCampaignListJsonSchema = z.toJSONSchema(
  DevelopmentCampaignListSchema,
  { target: 'draft-7', unrepresentable: 'throw' },
);
const DevelopmentCampaignPolicyListJsonSchema = z.toJSONSchema(
  z
    .object({
      schemaVersion: z.literal(1),
      policies: z.array(DevelopmentCampaignPolicySummarySchema).max(50),
    })
    .strict(),
  { target: 'draft-7', unrepresentable: 'throw' },
);

export function registerDevelopmentCampaignRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    campaigns: DevelopmentCampaignLifecycle & { wake(): void };
  },
) {
  app.get(
    '/v1/development-campaign-policies',
    { schema: { response: { 200: DevelopmentCampaignPolicyListJsonSchema } } },
    async () => ({
      schemaVersion: 1 as const,
      policies: await options.campaigns.listPolicies(options.principalId),
    }),
  );

  app.get(
    '/v1/development-campaigns',
    { schema: { response: { 200: DevelopmentCampaignListJsonSchema } } },
    async () => ({
      schemaVersion: 1 as const,
      campaigns: await options.campaigns.list(options.principalId),
    }),
  );

  app.post<{
    Headers: IdempotencyHeaders;
    Body: CreateDevelopmentCampaignRequest;
  }>(
    '/v1/development-campaigns',
    {
      schema: {
        headers: IdempotencyHeadersJsonSchema,
        body: CreateDevelopmentCampaignRequestJsonSchema,
        response: { 202: DevelopmentCampaignResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const campaign = await options.campaigns.create({
        principalId: options.principalId,
        requestKey: request.headers['idempotency-key'],
        ...request.body,
      });
      return reply
        .status(202)
        .header('location', `/v1/development-campaigns/${campaign.id}`)
        .send(campaign);
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/development-campaigns/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: DevelopmentCampaignResponseJsonSchema },
      },
    },
    async (request) =>
      options.campaigns.get(options.principalId, request.params.id),
  );

  app.post<{ Params: ResourceIdParams; Body: ApprovalDecisionRequest }>(
    '/v1/development-campaigns/:id/decision',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: DevelopmentCampaignResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const campaign = await options.campaigns.decideApproval({
        principalId: options.principalId,
        campaignId: request.params.id,
        decision: request.body.decision,
      });
      options.campaigns.wake();
      return reply.status(202).send(campaign);
    },
  );

  app.post<{ Params: ResourceIdParams; Headers: IdempotencyHeaders }>(
    '/v1/development-campaigns/:id/repairs',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 202: DevelopmentCampaignResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const campaign = await options.campaigns.requestRepair({
        principalId: options.principalId,
        campaignId: request.params.id,
        requestKey: request.headers['idempotency-key'],
      });
      return reply.status(202).send(campaign);
    },
  );

  app.post<{
    Params: CampaignRepairParams;
    Body: ApprovalDecisionRequest;
  }>(
    '/v1/development-campaigns/:id/repairs/:repairId/decision',
    {
      schema: {
        params: CampaignRepairParamsJsonSchema,
        body: ApprovalDecisionRequestJsonSchema,
        response: { 202: DevelopmentCampaignResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const campaign = await options.campaigns.decideRepair({
        principalId: options.principalId,
        campaignId: request.params.id,
        repairId: request.params.repairId,
        decision: request.body.decision,
      });
      options.campaigns.wake();
      return reply.status(202).send(campaign);
    },
  );

  app.post<{ Params: ResourceIdParams }>(
    '/v1/development-campaigns/:id/cancellation',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 202: DevelopmentCampaignResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const campaign = await options.campaigns.cancel({
        principalId: options.principalId,
        campaignId: request.params.id,
      });
      options.campaigns.wake();
      return reply.status(202).send(campaign);
    },
  );
}
