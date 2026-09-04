import {
  notificationCursor,
  parseNotificationCursor,
  type NotificationResource,
} from '../../domain/reminders/reminder.ts';
import type { ReminderStore } from '../../ports/persistence/reminder-store.ts';
import type { MissionStore } from '../../ports/persistence/mission-store.ts';
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
  missions?: MissionStore;
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
      const limit = query.limit ?? 100;
      const notificationOptions = {
        ...(after === undefined ? {} : { after }),
        limit,
      };
      const notifications = (
        await Promise.all([
          options.store.listNotifications(principalId, notificationOptions),
          ...(options.missions === undefined
            ? []
            : [
                options.missions.listNotifications(
                  principalId,
                  notificationOptions,
                ),
              ]),
        ])
      )
        .flat()
        .sort(
          (left, right) =>
            left.deliveredAt.localeCompare(right.deliveredAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
      const last = notifications.at(-1);
      return {
        schemaVersion: 1,
        notifications,
        ...(last === undefined ? {} : { nextCursor: notificationCursor(last) }),
      };
    },
  };
}
