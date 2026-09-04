import type {
  NotificationDevice,
  PushDelivery,
} from '../../domain/notifications/push-notification.ts';

export type PushNotificationStore = {
  upsertDevice(device: NotificationDevice): Promise<NotificationDevice>;
  findDeviceByInstallation(
    principalId: string,
    installationId: string,
  ): Promise<NotificationDevice | null>;
  findDeviceById(
    principalId: string,
    deviceId: string,
  ): Promise<NotificationDevice | null>;
  listDevices(principalId: string): Promise<NotificationDevice[]>;
  listActiveDevices(): Promise<NotificationDevice[]>;
  replaceDevice(
    device: NotificationDevice,
    expectedVersion: number,
  ): Promise<boolean>;
  createDelivery(
    delivery: PushDelivery,
  ): Promise<{ created: boolean; delivery: PushDelivery }>;
  findDeliveryById(
    principalId: string,
    deliveryId: string,
  ): Promise<PushDelivery | null>;
  listDeliveries(principalId: string, limit: number): Promise<PushDelivery[]>;
  findDueDeliveries(now: string, limit: number): Promise<PushDelivery[]>;
  replaceDelivery(
    delivery: PushDelivery,
    expectedVersion: number,
  ): Promise<boolean>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
