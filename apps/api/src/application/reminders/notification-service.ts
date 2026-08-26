import {
  notificationCursor,
  parseNotificationCursor,
  type NotificationResource,
} from '../../domain/reminders/reminder.ts';
import type { ReminderStore } from '../../ports/persistence/reminder-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type NotificationPage = {
  schemaVersion: 1;
  notifications: NotificationResource[];
  nextCursor?: string;
};

export type NotificationService = {
  list(
    principalId: string,
    options?: { after?: string; limit?: number },
  ): Promise<NotificationPage>;
};

export function createNotificationService(options: {
  store: ReminderStore;
}): NotificationService {
  return {
    async list(principalId, query = {}) {
      let after: { deliveredAt: string; id: string } | undefined;
      try {
        after =
          query.after === undefined
            ? undefined
            : parseNotificationCursor(query.after);
      } catch {
        throw new ResourceError(
          'The notification cursor is invalid.',
          'invalid_notification_cursor',
        );
      }
      const notifications = await options.store.listNotifications(principalId, {
        ...(after === undefined ? {} : { after }),
        limit: query.limit ?? 100,
      });
      const last = notifications.at(-1);
      return {
        schemaVersion: 1,
        notifications,
        ...(last === undefined ? {} : { nextCursor: notificationCursor(last) }),
      };
    },
  };
}
