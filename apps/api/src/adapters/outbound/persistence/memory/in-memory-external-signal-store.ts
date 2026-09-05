import type { ExternalSignal } from '../../../../domain/external-awareness/external-signal.ts';
import { externalSignalNotification } from '../../../../domain/external-awareness/external-signal-notification.ts';
import type { NotificationResource } from '../../../../domain/notifications/notification.ts';
import type { ExternalSignalStore } from '../../../../ports/persistence/external-signal-store.ts';

export class InMemoryExternalSignalStore implements ExternalSignalStore {
  private readonly signals = new Map<string, ExternalSignal>();

  public findById(principalId: string, signalId: string) {
    const signal = this.signals.get(signalId);
    return Promise.resolve(
      signal?.principalId === principalId ? structuredClone(signal) : null,
    );
  }

  public upsert(signal: ExternalSignal) {
    const current = this.signals.get(signal.id);
    if (current === undefined) {
      this.signals.set(signal.id, structuredClone(signal));
      return Promise.resolve({
        created: true,
        changed: true,
        signal: structuredClone(signal),
      });
    }
    const changed = signalFingerprint(current) !== signalFingerprint(signal);
    if (!changed) {
      return Promise.resolve({
        created: false,
        changed: false,
        signal: structuredClone(current),
      });
    }
    const next = { ...signal, version: current.version + 1 };
    this.signals.set(signal.id, structuredClone(next));
    return Promise.resolve({
      created: false,
      changed: true,
      signal: structuredClone(next),
    });
  }

  public resolveMissing(input: {
    principalId: string;
    routineId: string;
    activeIds: string[];
    resolvedAt: string;
  }) {
    const active = new Set(input.activeIds);
    let resolved = 0;
    for (const [id, current] of this.signals) {
      if (
        current.principalId !== input.principalId ||
        current.routineId !== input.routineId ||
        current.status !== 'active' ||
        active.has(id)
      )
        continue;
      this.signals.set(id, {
        ...current,
        version: current.version + 1,
        status: 'resolved',
        resolvedAt: input.resolvedAt,
        lastObservedAt: input.resolvedAt,
      });
      resolved += 1;
    }
    return Promise.resolve(resolved);
  }

  public listActive(principalId: string, limit: number) {
    return Promise.resolve(
      this.sorted(principalId)
        .filter(({ status }) => status === 'active')
        .slice(0, limit),
    );
  }

  public listByRoutine(principalId: string, routineId: string, limit: number) {
    return Promise.resolve(
      this.sorted(principalId)
        .filter((signal) => signal.routineId === routineId)
        .slice(0, limit),
    );
  }

  public listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ) {
    return Promise.resolve(
      this.sorted(principalId)
        .map(externalSignalNotification)
        .filter((notification) => after(notification, options.after))
        .sort(notificationOrder)
        .slice(0, options.limit),
    );
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.signals.clear();
    return Promise.resolve();
  }

  private sorted(principalId: string) {
    return [...this.signals.values()]
      .filter((signal) => signal.principalId === principalId)
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          right.id.localeCompare(left.id),
      )
      .map((signal) => structuredClone(signal));
  }
}

function signalFingerprint(signal: ExternalSignal) {
  return JSON.stringify([
    signal.category,
    signal.title,
    signal.summary,
    signal.url,
    signal.occurredAt,
    signal.status,
  ]);
}

function after(
  notification: NotificationResource,
  cursor?: { deliveredAt: string; id: string },
) {
  return (
    cursor === undefined ||
    notification.deliveredAt > cursor.deliveredAt ||
    (notification.deliveredAt === cursor.deliveredAt &&
      notification.id > cursor.id)
  );
}

function notificationOrder(
  left: NotificationResource,
  right: NotificationResource,
) {
  return (
    left.deliveredAt.localeCompare(right.deliveredAt) ||
    left.id.localeCompare(right.id)
  );
}
