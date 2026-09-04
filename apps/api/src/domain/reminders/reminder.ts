import { z } from 'zod';

import { ReminderNotificationResourceSchema } from '../notifications/notification.ts';
export {
  NotificationIdSchema,
  NotificationResourceSchema,
  notificationCursor,
  parseNotificationCursor,
  type NotificationResource,
} from '../notifications/notification.ts';

export const ReminderIdSchema = z
  .string()
  .regex(/^reminder_[a-z0-9][a-z0-9_-]*$/u);

export const ReminderStatusSchema = z.enum([
  'scheduled',
  'delivered',
  'acknowledged',
  'cancelled',
]);

const ReminderMutationSchema = z
  .object({
    invocationId: z.string().startsWith('invocation_'),
    orderKey: z.string().min(1),
  })
  .strict();

const ReminderClaimSchema = z
  .object({
    workerId: z.string().startsWith('reminder_worker_'),
    token: z.string().min(1),
    claimedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

const ReminderBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: ReminderIdSchema,
    principalId: z.string().min(1),
    message: z.string().trim().min(1).max(1_000),
    scheduledFor: z.iso.datetime(),
    timeZone: z.string().trim().min(1).max(100),
    status: ReminderStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    creationInvocationId: z.string().startsWith('invocation_'),
    lastMutation: ReminderMutationSchema,
    claim: ReminderClaimSchema.optional(),
    notification: ReminderNotificationResourceSchema.optional(),
    cancelledAt: z.iso.datetime().optional(),
    acknowledgedAt: z.iso.datetime().optional(),
  })
  .strict();

function validateReminderState(
  reminder: z.infer<typeof ReminderBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (
    ['scheduled', 'cancelled'].includes(reminder.status) &&
    reminder.notification !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['notification'],
      message: 'A scheduled or cancelled reminder cannot have a notification.',
    });
  }
  if (
    ['delivered', 'acknowledged'].includes(reminder.status) &&
    reminder.notification === undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['notification'],
      message: 'A delivered reminder requires its durable notification.',
    });
  }
  if (
    reminder.status === 'acknowledged' &&
    (reminder.acknowledgedAt === undefined ||
      reminder.notification?.status !== 'acknowledged' ||
      reminder.notification.acknowledgedAt !== reminder.acknowledgedAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['acknowledgedAt'],
      message: 'Acknowledgment state must agree with the notification.',
    });
  }
  if (
    reminder.status === 'delivered' &&
    (reminder.notification?.status !== 'unread' ||
      reminder.notification.acknowledgedAt !== undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['notification', 'status'],
      message: 'A delivered reminder must have an unread notification.',
    });
  }
  if (
    reminder.notification !== undefined &&
    (reminder.notification.reminderId !== reminder.id ||
      reminder.notification.id !==
        `notification_${reminder.id.slice('reminder_'.length)}` ||
      reminder.notification.message !== reminder.message ||
      reminder.notification.scheduledFor !== reminder.scheduledFor)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['notification'],
      message: 'Notification identity and content must match its reminder.',
    });
  }
  if (reminder.status === 'cancelled' && reminder.cancelledAt === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['cancelledAt'],
      message: 'A cancelled reminder requires cancelledAt.',
    });
  }
  if (reminder.status !== 'cancelled' && reminder.cancelledAt !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['cancelledAt'],
      message: 'Only a cancelled reminder may have cancelledAt.',
    });
  }
  if (
    reminder.status !== 'acknowledged' &&
    reminder.acknowledgedAt !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['acknowledgedAt'],
      message: 'Only an acknowledged reminder may have acknowledgedAt.',
    });
  }
  if (reminder.status !== 'scheduled' && reminder.claim !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['claim'],
      message: 'Only scheduled reminders may hold a delivery claim.',
    });
  }
}

export const ReminderSchema = ReminderBaseSchema.superRefine(
  validateReminderState,
);

export const ReminderResourceSchema = ReminderBaseSchema.omit({
  principalId: true,
  creationInvocationId: true,
  lastMutation: true,
  claim: true,
}).superRefine((reminder, context) => {
  validateReminderState(
    {
      ...reminder,
      principalId: 'resource_validation',
      creationInvocationId: 'invocation_resource_validation',
      lastMutation: {
        invocationId: 'invocation_resource_validation',
        orderKey: 'resource_validation',
      },
    },
    context,
  );
});

export const ReminderActionArgumentsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      message: z.string().trim().min(1).max(1_000),
      scheduledFor: z.iso.datetime(),
      timeZone: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal('list'),
      status: z
        .enum(['all', 'scheduled', 'delivered', 'acknowledged', 'cancelled'])
        .optional(),
      limit: z.number().int().positive().max(100).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('reschedule'),
      reminderId: ReminderIdSchema,
      scheduledFor: z.iso.datetime(),
      timeZone: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.enum(['cancel', 'acknowledge']),
      reminderId: ReminderIdSchema,
    })
    .strict(),
]);

export const ReminderResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.enum(['create', 'list', 'reschedule', 'cancel', 'acknowledge']),
    summary: z.string().trim().min(1).max(1_000),
    reminders: z.array(ReminderResourceSchema).max(100),
  })
  .strict();

export type Reminder = z.infer<typeof ReminderSchema>;
export type ReminderResource = z.infer<typeof ReminderResourceSchema>;
export type ReminderActionArguments = z.infer<
  typeof ReminderActionArgumentsSchema
>;
export type ReminderResult = z.infer<typeof ReminderResultSchema>;

export function reminderResource(reminder: Reminder): ReminderResource {
  const {
    principalId: ignoredPrincipal,
    creationInvocationId: ignoredCreation,
    lastMutation: ignoredMutation,
    claim: ignoredClaim,
    ...resource
  } = reminder;
  void ignoredPrincipal;
  void ignoredCreation;
  void ignoredMutation;
  void ignoredClaim;
  return ReminderResourceSchema.parse(resource);
}
