import {
  NotificationDeviceSchema,
  PushDeliverySchema,
  type PushDelivery,
} from '../../domain/notifications/push-notification.ts';
import type { PushNotificationProvider } from '../../ports/notifications/push-notification-provider.ts';
import type { PushNotificationStore } from '../../ports/persistence/push-notification-store.ts';
import type { WorkLeaseStore } from '../../ports/persistence/work-lease-store.ts';
import {
  nextAllowedTime,
  type PushNotificationService,
} from './push-notification-service.ts';
import { randomUUID } from 'node:crypto';

const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export function createPushNotificationWorker(options: {
  store: PushNotificationStore;
  service: PushNotificationService;
  provider: PushNotificationProvider;
  leases: WorkLeaseStore;
  pollIntervalMs: number;
  receiptDelayMs: number;
  maxAttempts: number;
  leaseMs: number;
  clock?: () => Date;
  warning?: (error: unknown, context: Record<string, unknown>) => void;
}) {
  const clock = options.clock ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopping = false;
  function schedule(delay = options.pollIntervalMs) {
    if (stopping || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void poll();
    }, delay);
  }
  async function poll() {
    if (running || stopping) return;
    running = true;
    try {
      await options.service.materialize();
      const due = await options.store.findDueDeliveries(
        clock().toISOString(),
        20,
      );
      await Promise.all(due.map(process));
    } catch (error) {
      options.warning?.(error, { component: 'push_notification_worker' });
    } finally {
      running = false;
      schedule();
    }
  }
  async function process(delivery: PushDelivery) {
    const acquiredAt = clock();
    const token = randomUUID();
    const leaseId = `push:${delivery.id}`;
    const claimed = await options.leases.claim(
      {
        schemaVersion: 1,
        runId: leaseId,
        workerId: 'push_notification_worker',
        token,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: new Date(
          acquiredAt.getTime() + options.leaseMs,
        ).toISOString(),
      },
      acquiredAt.toISOString(),
    );
    if (!claimed) return;
    try {
      await processClaimed(delivery);
    } finally {
      await options.leases.release(leaseId, token);
    }
  }
  async function processClaimed(delivery: PushDelivery) {
    const device = await options.store.findDeviceById(
      delivery.principalId,
      delivery.deviceId,
    );
    if (
      delivery.status === 'accepted' &&
      delivery.providerTicketId !== undefined
    ) {
      if (
        clock().getTime() - Date.parse(delivery.createdAt) >=
        RECEIPT_MAX_AGE_MS
      )
        return transition(delivery, {
          status: 'failed',
          failureCode: 'push_receipt_expired',
        });
      const result = await options.provider.receipt(delivery.providerTicketId);
      if (result.status === 'pending' || result.status === 'retryable')
        return transition(delivery, {
          nextAttemptAt: new Date(
            clock().getTime() + options.receiptDelayMs,
          ).toISOString(),
          ...(result.status === 'retryable'
            ? { failureCode: result.code }
            : {}),
        });
      if (result.status === 'delivered')
        return transition(delivery, {
          status: 'delivered',
          failureCode: undefined,
        });
      if (result.deviceInvalid && device !== null) await invalidate(device);
      return transition(delivery, {
        status: 'failed',
        failureCode: result.code,
      });
    }
    if (device?.status !== 'active')
      return transition(delivery, {
        status: 'cancelled',
        failureCode: 'device_inactive',
      });
    if (delivery.category !== 'test' && !device.preferences[delivery.category])
      return transition(delivery, {
        status: 'cancelled',
        failureCode: 'category_disabled',
      });
    if (delivery.category !== 'test') {
      const dispatchTime = clock();
      const allowedAt = nextAllowedTime(dispatchTime, device.preferences);
      if (allowedAt > dispatchTime.toISOString())
        return transition(delivery, { nextAttemptAt: allowedAt });
    }
    const result = await options.provider.send({
      token: device.pushToken,
      title: 'Vera needs your attention',
      body: bodyFor(delivery.category),
      data: { deepLink: delivery.deepLink, deliveryId: delivery.id },
    });
    if (result.status === 'accepted')
      return transition(delivery, {
        status: 'accepted',
        attempts: delivery.attempts + 1,
        providerTicketId: result.ticketId,
        nextAttemptAt: new Date(
          clock().getTime() + options.receiptDelayMs,
        ).toISOString(),
        failureCode: undefined,
      });
    if (
      result.status === 'retryable' &&
      delivery.attempts + 1 < options.maxAttempts
    )
      return transition(delivery, {
        attempts: delivery.attempts + 1,
        failureCode: result.code,
        nextAttemptAt: new Date(
          clock().getTime() + Math.min(60_000, 1_000 * 2 ** delivery.attempts),
        ).toISOString(),
      });
    if (result.status === 'rejected' && result.deviceInvalid)
      await invalidate(device);
    return transition(delivery, {
      status: 'failed',
      attempts: delivery.attempts + 1,
      failureCode: result.code,
    });
  }
  async function transition(
    delivery: PushDelivery,
    patch: Partial<PushDelivery>,
  ) {
    const candidate = Object.fromEntries(
      Object.entries({
        ...delivery,
        ...patch,
        version: delivery.version + 1,
        updatedAt: clock().toISOString(),
      }).filter((entry) => entry[1] !== undefined),
    );
    const updated = PushDeliverySchema.parse(candidate);
    await options.store.replaceDelivery(updated, delivery.version);
  }
  async function invalidate(
    device: NonNullable<
      Awaited<ReturnType<PushNotificationStore['findDeviceById']>>
    >,
  ) {
    const now = clock().toISOString();
    await options.store.replaceDevice(
      NotificationDeviceSchema.parse({
        ...device,
        version: device.version + 1,
        status: 'invalid',
        invalidatedAt: now,
        updatedAt: now,
      }),
      device.version,
    );
  }
  return {
    start() {
      stopping = false;
      schedule(0);
    },
    wake() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      schedule(0);
    },
    async stop() {
      stopping = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      while (running) await new Promise((resolve) => setTimeout(resolve, 10));
    },
    async checkReadiness() {
      await Promise.all([
        options.store.checkReadiness(),
        options.provider.checkReadiness(),
        options.leases.checkReadiness(),
      ]);
    },
    runOnce: poll,
  };
}

function bodyFor(category: PushDelivery['category']) {
  if (category === 'test') return 'Device notifications are working.';
  return category === 'approvals'
    ? 'An approval is waiting for you.'
    : category === 'reminders'
      ? 'A reminder is ready.'
      : category === 'tasks'
        ? 'A task needs your attention.'
        : category === 'failures'
          ? 'Something needs your review.'
          : 'A result is ready for you.';
}
