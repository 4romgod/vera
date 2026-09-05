import { randomUUID } from 'node:crypto';

import {
  NotificationDeviceResponseSchema,
  NotificationDeviceSchema,
  PushDeliverySchema,
  PushPreferencesSchema,
  type NotificationDevice,
  type NotificationDeviceRegistration,
  type NotificationDeviceResponse,
  type PushCategory,
  type PushDelivery,
  type PushPreferences,
} from '../../domain/notifications/push-notification.ts';
import type { AttentionService } from '../../ports/attention/attention-service.ts';
import type { PushNotificationProvider } from '../../ports/notifications/push-notification-provider.ts';
import type { PushNotificationStore } from '../../ports/persistence/push-notification-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type PushNotificationService = ReturnType<
  typeof createPushNotificationService
>;

export function createPushNotificationService(options: {
  store: PushNotificationStore;
  attention: AttentionService;
  provider?: PushNotificationProvider;
  projectId?: string;
  clock?: () => Date;
  wake?: () => void;
}) {
  const clock = options.clock ?? (() => new Date());
  function response(device: NotificationDevice): NotificationDeviceResponse {
    const { principalId: ignoredPrincipal, pushToken, ...safe } = device;
    void ignoredPrincipal;
    return NotificationDeviceResponseSchema.parse({
      ...safe,
      tokenSuffix: pushToken.slice(-8),
    });
  }
  async function requireDevice(principalId: string, id: string) {
    const device = await options.store.findDeviceById(principalId, id);
    if (device === null)
      throw new ResourceError(
        `Notification device ${id} was not found.`,
        'notification_device_not_found',
      );
    return device;
  }
  return {
    status() {
      return {
        schemaVersion: 1 as const,
        enabled: options.provider !== undefined,
        provider: options.provider?.name,
        projectId: options.projectId,
      };
    },
    async register(principalId: string, input: NotificationDeviceRegistration) {
      if (options.provider === undefined || options.projectId === undefined) {
        throw new ResourceError(
          'Push notifications are not configured on this Vera server.',
          'push_notifications_disabled',
        );
      }
      if (input.projectId !== options.projectId) {
        throw new ResourceError(
          'This push token belongs to a different Expo project.',
          'notification_project_mismatch',
        );
      }
      const now = clock().toISOString();
      const existing = await options.store.findDeviceByInstallation(
        principalId,
        input.installationId,
      );
      const device = NotificationDeviceSchema.parse({
        schemaVersion: 1,
        version: (existing?.version ?? 0) + 1,
        id: existing?.id ?? `notification_device_${randomUUID()}`,
        principalId,
        ...input,
        status: 'active',
        preferences: existing?.preferences ?? PushPreferencesSchema.parse({}),
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now,
      });
      await options.store.upsertDevice(device);
      options.wake?.();
      return response(device);
    },
    async listDevices(principalId: string) {
      return {
        schemaVersion: 1 as const,
        devices: (await options.store.listDevices(principalId)).map(response),
      };
    },
    async updatePreferences(
      principalId: string,
      id: string,
      preferences: PushPreferences,
    ) {
      const current = await requireDevice(principalId, id);
      validateTimeZone(preferences.quietHours?.timeZone);
      const updated = NotificationDeviceSchema.parse({
        ...current,
        version: current.version + 1,
        preferences,
        updatedAt: clock().toISOString(),
      });
      if (!(await options.store.replaceDevice(updated, current.version)))
        throw new ResourceError(
          'The notification device changed concurrently.',
          'concurrent_transition_failed',
        );
      options.wake?.();
      return response(updated);
    },
    async revoke(principalId: string, id: string) {
      const current = await requireDevice(principalId, id);
      if (current.status === 'revoked') return response(current);
      const now = clock().toISOString();
      const updated = NotificationDeviceSchema.parse({
        ...current,
        version: current.version + 1,
        status: 'revoked',
        updatedAt: now,
        revokedAt: now,
      });
      if (!(await options.store.replaceDevice(updated, current.version)))
        throw new ResourceError(
          'The notification device changed concurrently.',
          'concurrent_transition_failed',
        );
      return response(updated);
    },
    async test(principalId: string, id: string, requestKey: string) {
      const device = await requireDevice(principalId, id);
      if (device.status !== 'active')
        throw new ResourceError(
          'This notification device is not active.',
          'notification_device_inactive',
        );
      const now = clock().toISOString();
      const created = await options.store.createDelivery(
        PushDeliverySchema.parse({
          schemaVersion: 1,
          version: 1,
          id: `push_delivery_${randomUUID()}`,
          principalId,
          deviceId: id,
          sourceId: `test:${requestKey}`,
          category: 'test',
          deepLink: 'vera://attention',
          status: 'queued',
          attempts: 0,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      );
      options.wake?.();
      return publicDelivery(created.delivery);
    },
    async listDeliveries(principalId: string, limit: number) {
      return {
        schemaVersion: 1 as const,
        deliveries: (
          await options.store.listDeliveries(principalId, limit)
        ).map(publicDelivery),
      };
    },
    materialize: async () => {
      const devices = await options.store.listActiveDevices();
      const byPrincipal = Map.groupBy(devices, (device) => device.principalId);
      for (const [principalId, principalDevices] of byPrincipal) {
        const briefing = await options.attention.getBriefing(principalId);
        for (const device of principalDevices) {
          for (const item of briefing.items) {
            const category = categoryForReason(item.reason);
            if (
              category === undefined ||
              category === 'test' ||
              !device.preferences[category] ||
              item.occurredAt < device.registeredAt
            )
              continue;
            const now = clock().toISOString();
            await options.store.createDelivery(
              PushDeliverySchema.parse({
                schemaVersion: 1,
                version: 1,
                id: `push_delivery_${randomUUID()}`,
                principalId,
                deviceId: device.id,
                sourceId: item.id,
                category,
                deepLink: `vera://attention/${encodeURIComponent(item.id)}`,
                status: 'queued',
                attempts: 0,
                nextAttemptAt: nextAllowedTime(clock(), device.preferences),
                createdAt: now,
                updatedAt: now,
              }),
            );
          }
        }
      }
    },
  };
}

export function publicDelivery(delivery: PushDelivery) {
  const {
    principalId: ignoredPrincipal,
    providerTicketId: ignoredProviderTicket,
    ...value
  } = delivery;
  void ignoredPrincipal;
  void ignoredProviderTicket;
  return value;
}

export function categoryForReason(reason: string): PushCategory | undefined {
  if (['approval_required', 'routine_approval_required'].includes(reason))
    return 'approvals';
  if (reason === 'reminder_delivered') return 'reminders';
  if (['task_due_soon', 'task_overdue'].includes(reason)) return 'tasks';
  if (
    [
      'run_failed',
      'mission_review_required',
      'mission_failed',
      'campaign_review_required',
      'campaign_failed',
      'routine_check_failed',
      'routine_attention_required',
      'external_check_failed',
    ].includes(reason)
  )
    return 'failures';
  if (['mission_result_ready', 'campaign_result_ready'].includes(reason))
    return 'results';
  if (
    [
      'external_review_requested',
      'external_mentioned',
      'external_assigned',
    ].includes(reason)
  )
    return 'tasks';
  return undefined;
}

export function nextAllowedTime(
  now: Date,
  preferences: PushPreferences,
): string {
  const quiet = preferences.quietHours;
  if (quiet === undefined || quiet.startLocalTime === quiet.endLocalTime)
    return now.toISOString();
  const start = minutes(quiet.startLocalTime);
  const end = minutes(quiet.endLocalTime);
  const current = localMinutes(now, quiet.timeZone);
  const isQuiet =
    start < end
      ? current >= start && current < end
      : current >= start || current < end;
  if (!isQuiet) return now.toISOString();
  for (let offset = 1; offset <= 48 * 60; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 60_000);
    const candidateMinutes = localMinutes(candidate, quiet.timeZone);
    const stillQuiet =
      start < end
        ? candidateMinutes >= start && candidateMinutes < end
        : candidateMinutes >= start || candidateMinutes < end;
    if (!stillQuiet) return candidate.toISOString();
  }
  return new Date(now.getTime() + 48 * 60 * 60_000).toISOString();
}
function minutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}
function localMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return (
    Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  );
}
function validateTimeZone(value?: string) {
  if (value === undefined) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
  } catch {
    throw new ResourceError(
      `Invalid IANA time zone ${value}.`,
      'invalid_notification_preferences',
    );
  }
}
