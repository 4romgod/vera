import type {
  NotificationResource,
  Reminder,
  ReminderActionArguments,
} from '../../domain/reminders/reminder.ts';

export type ReminderListStatus =
  | 'all'
  | 'scheduled'
  | 'delivered'
  | 'acknowledged'
  | 'cancelled';

export type ReminderStore = {
  createReminder(reminder: Reminder): Promise<Reminder>;
  findReminderByCreationInvocation(
    principalId: string,
    invocationId: string,
  ): Promise<Reminder | null>;
  findReminderById(
    principalId: string,
    reminderId: string,
  ): Promise<Reminder | null>;
  listReminders(
    principalId: string,
    options: { status: ReminderListStatus; limit: number },
  ): Promise<Reminder[]>;
  mutateReminder(input: {
    principalId: string;
    reminderId: string;
    action: Extract<
      ReminderActionArguments,
      { action: 'reschedule' | 'cancel' | 'acknowledge' }
    >;
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<Reminder | null>;
  claimDueReminder(input: {
    workerId: string;
    token: string;
    now: string;
    expiresAt: string;
  }): Promise<Reminder | null>;
  finalizeReminderDelivery(input: {
    principalId: string;
    reminderId: string;
    workerId: string;
    token: string;
    deliveredAt: string;
  }): Promise<Reminder | null>;
  releaseReminderClaim(input: {
    reminderId: string;
    workerId: string;
    token: string;
  }): Promise<void>;
  listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ): Promise<NotificationResource[]>;
};

export function reminderMutationOrderKey(
  mutationAt: string,
  invocationId: string,
): string {
  return `${mutationAt}\u0000${invocationId}`;
}

export function reminderIdForInvocation(invocationId: string): string {
  return `reminder_${invocationId.slice('invocation_'.length)}`;
}

export function notificationIdForReminder(reminderId: string): string {
  return `notification_${reminderId.slice('reminder_'.length)}`;
}
