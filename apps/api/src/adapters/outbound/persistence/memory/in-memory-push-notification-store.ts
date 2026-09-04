import type {
  NotificationDevice,
  PushDelivery,
} from '../../../../domain/notifications/push-notification.ts';
import type { PushNotificationStore } from '../../../../ports/persistence/push-notification-store.ts';

export class InMemoryPushNotificationStore implements PushNotificationStore {
  private readonly devices = new Map<string, NotificationDevice>();
  private readonly deliveries = new Map<string, PushDelivery>();

  upsertDevice(device: NotificationDevice) {
    const existing = [...this.devices.values()].find(
      (value) =>
        value.principalId === device.principalId &&
        value.installationId === device.installationId,
    );
    if (existing !== undefined && existing.id !== device.id)
      this.devices.delete(existing.id);
    this.devices.set(device.id, structuredClone(device));
    return Promise.resolve(structuredClone(device));
  }
  findDeviceByInstallation(principalId: string, installationId: string) {
    const value = [...this.devices.values()].find(
      (item) =>
        item.principalId === principalId &&
        item.installationId === installationId,
    );
    return Promise.resolve(value === undefined ? null : structuredClone(value));
  }
  findDeviceById(principalId: string, deviceId: string) {
    const value = this.devices.get(deviceId);
    return Promise.resolve(
      value?.principalId === principalId ? structuredClone(value) : null,
    );
  }
  listDevices(principalId: string) {
    return Promise.resolve(
      [...this.devices.values()]
        .filter((item) => item.principalId === principalId)
        .map((item) => structuredClone(item)),
    );
  }
  listActiveDevices() {
    return Promise.resolve(
      [...this.devices.values()]
        .filter((item) => item.status === 'active')
        .map((item) => structuredClone(item)),
    );
  }
  replaceDevice(device: NotificationDevice, expectedVersion: number) {
    const current = this.devices.get(device.id);
    if (current?.version !== expectedVersion) return Promise.resolve(false);
    this.devices.set(device.id, structuredClone(device));
    return Promise.resolve(true);
  }
  createDelivery(delivery: PushDelivery) {
    const existing = [...this.deliveries.values()].find(
      (value) =>
        value.deviceId === delivery.deviceId &&
        value.sourceId === delivery.sourceId,
    );
    if (existing !== undefined)
      return Promise.resolve({
        created: false,
        delivery: structuredClone(existing),
      });
    this.deliveries.set(delivery.id, structuredClone(delivery));
    return Promise.resolve({
      created: true,
      delivery: structuredClone(delivery),
    });
  }
  findDeliveryById(principalId: string, deliveryId: string) {
    const value = this.deliveries.get(deliveryId);
    return Promise.resolve(
      value?.principalId === principalId ? structuredClone(value) : null,
    );
  }
  listDeliveries(principalId: string, limit: number) {
    return Promise.resolve(
      [...this.deliveries.values()]
        .filter((item) => item.principalId === principalId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((item) => structuredClone(item)),
    );
  }
  findDueDeliveries(now: string, limit: number) {
    return Promise.resolve(
      [...this.deliveries.values()]
        .filter(
          (item) =>
            (item.status === 'queued' || item.status === 'accepted') &&
            item.nextAttemptAt <= now,
        )
        .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
        .slice(0, limit)
        .map((item) => structuredClone(item)),
    );
  }
  replaceDelivery(delivery: PushDelivery, expectedVersion: number) {
    const current = this.deliveries.get(delivery.id);
    if (current?.version !== expectedVersion) return Promise.resolve(false);
    this.deliveries.set(delivery.id, structuredClone(delivery));
    return Promise.resolve(true);
  }
  checkReadiness() {
    return Promise.resolve();
  }
  close() {
    this.devices.clear();
    this.deliveries.clear();
    return Promise.resolve();
  }
}
