import { randomUUID } from 'node:crypto';

import type { ReminderNotificationDelivery } from '../../ports/notifications/reminder-notification-delivery.ts';
import type { ReminderStore } from '../../ports/persistence/reminder-store.ts';

export type ReminderWorker = {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  runOnce(): Promise<number>;
  checkReadiness(): Promise<void>;
};

export function createReminderWorker(options: {
  workerId?: string;
  store: ReminderStore;
  delivery: ReminderNotificationDelivery;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  clock?: () => Date;
  createToken?: () => string;
  warning?: (error: unknown, context: Record<string, unknown>) => void;
}): ReminderWorker {
  const workerId = options.workerId ?? `reminder_worker_${randomUUID()}`;
  const clock = options.clock ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  const warning = options.warning ?? (() => undefined);
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeWaiter: (() => void) | undefined;

  async function processOne(): Promise<boolean> {
    const now = clock();
    const token = createToken();
    const reminder = await options.store.claimDueReminder({
      workerId,
      token,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + options.leaseMs).toISOString(),
    });
    if (reminder === null) return false;
    try {
      const notification = await options.delivery.deliver({
        reminder,
        workerId,
        token,
        deliveredAt: clock().toISOString(),
      });
      if (notification === null) {
        throw new Error(
          `Reminder ${reminder.id} could not be finalized with its active delivery claim.`,
        );
      }
      return true;
    } catch (error) {
      warning(error, {
        operation: 'reminder_delivery',
        workerId,
        reminderId: reminder.id,
      });
      try {
        await options.store.releaseReminderClaim({
          reminderId: reminder.id,
          workerId,
          token,
        });
      } catch (releaseError) {
        warning(releaseError, {
          operation: 'reminder_claim_release',
          workerId,
          reminderId: reminder.id,
        });
      }
      return false;
    }
  }

  async function runOnce(): Promise<number> {
    let delivered = 0;
    await Promise.all(
      Array.from({ length: options.concurrency }, async () => {
        if (await processOne()) delivered += 1;
      }),
    );
    return delivered;
  }

  function waitForWork(): Promise<void> {
    if (!running) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeWaiter = undefined;
        resolve();
      }, options.pollIntervalMs);
      wakeWaiter = () => {
        clearTimeout(timer);
        wakeWaiter = undefined;
        resolve();
      };
    });
  }

  async function workLoop(): Promise<void> {
    while (running) {
      try {
        if ((await runOnce()) > 0) continue;
      } catch (error) {
        warning(error, { operation: 'reminder_worker_poll', workerId });
      }
      await waitForWork();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loop = workLoop();
    },
    async stop() {
      if (!running) return;
      running = false;
      wakeWaiter?.();
      await loop;
      loop = undefined;
    },
    wake() {
      wakeWaiter?.();
    },
    runOnce,
    async checkReadiness() {
      if (!running) throw new Error('The reminder worker is not running.');
      await options.delivery.checkReadiness();
    },
  };
}
