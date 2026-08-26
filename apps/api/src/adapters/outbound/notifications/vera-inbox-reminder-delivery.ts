import type {
  NotificationResource,
  Reminder,
} from '../../../domain/reminders/reminder.ts';
import type { ReminderNotificationDelivery } from '../../../ports/notifications/reminder-notification-delivery.ts';
import type { ReminderStore } from '../../../ports/persistence/reminder-store.ts';

export class VeraInboxReminderDelivery implements ReminderNotificationDelivery {
  public readonly destination = {
    schemaVersion: 1 as const,
    adapterId: 'vera_notification_inbox',
    provider: 'vera',
    transport: 'local_store',
    dataBoundary: 'owner_controlled' as const,
  };

  public constructor(private readonly store: ReminderStore) {}

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public async deliver(input: {
    reminder: Reminder;
    workerId: string;
    token: string;
    deliveredAt: string;
  }): Promise<NotificationResource | null> {
    const reminder = await this.store.finalizeReminderDelivery({
      principalId: input.reminder.principalId,
      reminderId: input.reminder.id,
      workerId: input.workerId,
      token: input.token,
      deliveredAt: input.deliveredAt,
    });
    return reminder?.notification ?? null;
  }
}
