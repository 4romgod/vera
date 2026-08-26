import type {
  NotificationResource,
  Reminder,
} from '../../domain/reminders/reminder.ts';
import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';

/**
 * Delivery boundary for a claimed reminder. The implementation must make the
 * notification durable before reporting success and must be idempotent for a
 * reminder. The active claim identity gates the first state transition.
 */
export type ReminderNotificationDelivery = {
  readonly destination: CapabilityDestination;
  checkReadiness(): Promise<void>;
  deliver(input: {
    reminder: Reminder;
    workerId: string;
    token: string;
    deliveredAt: string;
  }): Promise<NotificationResource | null>;
};
