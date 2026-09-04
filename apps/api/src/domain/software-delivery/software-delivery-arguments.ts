import { z } from 'zod';

export const SoftwareDeliveryResourceReferenceSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        kind: z.literal('mission'),
        id: z.string().startsWith('mission_'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('development_campaign'),
        id: z.string().startsWith('campaign_'),
      })
      .strict(),
  ],
);

export const SoftwareDeliveryManagementArgumentsSchema = z.discriminatedUnion(
  'action',
  [
    z
      .object({
        action: z.literal('list'),
        scope: z.enum(['active', 'all']).default('active'),
      })
      .strict(),
    z
      .object({
        action: z.literal('inspect'),
        target: SoftwareDeliveryResourceReferenceSchema,
      })
      .strict(),
  ],
);

export const SoftwareDeliveryRepairArgumentsSchema = z
  .object({
    action: z.literal('prepare_repair'),
    campaignId: z.string().startsWith('campaign_'),
  })
  .strict();

export const SoftwareDeliveryActionArgumentsSchema = z.union([
  SoftwareDeliveryManagementArgumentsSchema,
  SoftwareDeliveryRepairArgumentsSchema,
]);

export type SoftwareDeliveryManagementArguments = z.infer<
  typeof SoftwareDeliveryManagementArgumentsSchema
>;
export type SoftwareDeliveryRepairArguments = z.infer<
  typeof SoftwareDeliveryRepairArgumentsSchema
>;
export type SoftwareDeliveryActionArguments = z.infer<
  typeof SoftwareDeliveryActionArgumentsSchema
>;
