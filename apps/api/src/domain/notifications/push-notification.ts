import { z } from 'zod';

export const PushCategorySchema = z.enum([
  'approvals',
  'reminders',
  'tasks',
  'failures',
  'results',
  'test',
]);

export const PushPreferencesSchema = z
  .object({
    approvals: z.boolean().default(true),
    reminders: z.boolean().default(true),
    tasks: z.boolean().default(true),
    failures: z.boolean().default(true),
    results: z.boolean().default(true),
    quietHours: z
      .object({
        timeZone: z.string().trim().min(1).max(100),
        startLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
        endLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
      })
      .strict()
      .optional(),
  })
  .strict();

export const NotificationDeviceSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('notification_device_'),
    principalId: z.string().min(1),
    installationId: z.string().trim().min(8).max(200),
    provider: z.literal('expo'),
    projectId: z.string().trim().min(1).max(200),
    pushToken: z
      .string()
      .regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/u),
    platform: z.enum(['ios', 'android']),
    name: z.string().trim().min(1).max(200),
    status: z.enum(['active', 'revoked', 'invalid']),
    preferences: PushPreferencesSchema,
    registeredAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
    invalidatedAt: z.iso.datetime().optional(),
  })
  .strict();

export const NotificationDeviceRegistrationSchema = z
  .object({
    installationId: z.string().trim().min(8).max(200),
    provider: z.literal('expo'),
    projectId: z.string().trim().min(1).max(200),
    pushToken: z
      .string()
      .regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/u),
    platform: z.enum(['ios', 'android']),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const NotificationDeviceResponseSchema = NotificationDeviceSchema.omit({
  principalId: true,
  pushToken: true,
}).extend({ tokenSuffix: z.string().min(4).max(12) });

export const PushDeliverySchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('push_delivery_'),
    principalId: z.string().min(1),
    deviceId: z.string().startsWith('notification_device_'),
    sourceId: z.string().min(1).max(200),
    category: PushCategorySchema,
    deepLink: z.string().startsWith('vera://'),
    status: z.enum(['queued', 'accepted', 'delivered', 'failed', 'cancelled']),
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.iso.datetime(),
    providerTicketId: z.string().min(1).max(500).optional(),
    failureCode: z.string().min(1).max(100).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type PushCategory = z.infer<typeof PushCategorySchema>;
export type PushPreferences = z.infer<typeof PushPreferencesSchema>;
export type NotificationDevice = z.infer<typeof NotificationDeviceSchema>;
export type NotificationDeviceRegistration = z.infer<
  typeof NotificationDeviceRegistrationSchema
>;
export type NotificationDeviceResponse = z.infer<
  typeof NotificationDeviceResponseSchema
>;
export type PushDelivery = z.infer<typeof PushDeliverySchema>;

export const NotificationDeviceJsonSchema = z.toJSONSchema(
  NotificationDeviceSchema,
  { target: 'draft-7' },
);
export const PushDeliveryJsonSchema = z.toJSONSchema(PushDeliverySchema, {
  target: 'draft-7',
});
