import { z } from 'zod';

import { ExternalSignalCategorySchema } from '../external-awareness/external-signal.ts';

export const NotificationIdSchema = z
  .string()
  .regex(/^notification_[a-z0-9][a-z0-9_-]*$/u);

const NotificationBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: NotificationIdSchema,
    message: z.string().trim().min(1).max(1_000),
    deliveredAt: z.iso.datetime(),
    status: z.enum(['unread', 'acknowledged']),
    channel: z.literal('vera_inbox'),
    acknowledgedAt: z.iso.datetime().optional(),
  })
  .strict();

export const ReminderNotificationResourceSchema = NotificationBaseSchema.extend(
  {
    reminderId: z.string().regex(/^reminder_[a-z0-9][a-z0-9_-]*$/u),
    scheduledFor: z.iso.datetime(),
  },
).strict();

export const MissionNotificationResourceSchema = NotificationBaseSchema.extend({
  missionId: z.string().startsWith('mission_'),
  outcome: z.enum(['succeeded', 'review_required', 'failed', 'cancelled']),
  pullRequestUrl: z.url().optional(),
}).strict();

export const ExternalSignalNotificationResourceSchema =
  NotificationBaseSchema.extend({
    externalSignalId: z.string().startsWith('external_signal_'),
    routineId: z.string().startsWith('routine_'),
    category: ExternalSignalCategorySchema,
    source: z.literal('github'),
    url: z.url(),
  }).strict();

export const NotificationResourceSchema = z.union([
  ReminderNotificationResourceSchema,
  MissionNotificationResourceSchema,
  ExternalSignalNotificationResourceSchema,
]);

export type NotificationResource = z.infer<typeof NotificationResourceSchema>;
export type MissionNotificationResource = z.infer<
  typeof MissionNotificationResourceSchema
>;

export function notificationCursor(notification: NotificationResource): string {
  return Buffer.from(
    JSON.stringify([notification.deliveredAt, notification.id]),
    'utf8',
  ).toString('base64url');
}

export function parseNotificationCursor(cursor: string): {
  deliveredAt: string;
  id: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Notification cursor is invalid.');
  }
  const parsed = z
    .tuple([z.iso.datetime(), NotificationIdSchema])
    .safeParse(value);
  if (!parsed.success) throw new Error('Notification cursor is invalid.');
  return { deliveredAt: parsed.data[0], id: parsed.data[1] };
}
