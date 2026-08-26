import {
  reminderResource,
  type ReminderResource,
} from '../../domain/reminders/reminder.ts';
import type {
  ReminderListStatus,
  ReminderStore,
} from '../../ports/persistence/reminder-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type ReminderService = {
  list(
    principalId: string,
    options?: { status?: ReminderListStatus; limit?: number },
  ): Promise<ReminderResource[]>;
  get(principalId: string, reminderId: string): Promise<ReminderResource>;
};

export function createReminderService(options: {
  store: ReminderStore;
}): ReminderService {
  return {
    async list(principalId, query = {}) {
      const reminders = await options.store.listReminders(principalId, {
        status: query.status ?? 'scheduled',
        limit: query.limit ?? 50,
      });
      return reminders.map(reminderResource);
    },
    async get(principalId, reminderId) {
      const reminder = await options.store.findReminderById(
        principalId,
        reminderId,
      );
      if (reminder === null) {
        throw new ResourceError(
          `Reminder ${reminderId} was not found.`,
          'reminder_not_found',
        );
      }
      return reminderResource(reminder);
    },
  };
}
