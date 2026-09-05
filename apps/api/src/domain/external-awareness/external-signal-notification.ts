import {
  ExternalSignalNotificationResourceSchema,
  type NotificationResource,
} from '../notifications/notification.ts';
import type { ExternalSignal } from './external-signal.ts';

export function externalSignalNotification(
  signal: ExternalSignal,
): NotificationResource {
  return ExternalSignalNotificationResourceSchema.parse({
    schemaVersion: 1,
    id: `notification_${signal.id.slice('external_signal_'.length)}`,
    message: signal.title,
    deliveredAt: signal.firstObservedAt,
    status: 'unread',
    channel: 'vera_inbox',
    externalSignalId: signal.id,
    routineId: signal.routineId,
    category: signal.category,
    source: 'github',
    url: signal.url,
  });
}
