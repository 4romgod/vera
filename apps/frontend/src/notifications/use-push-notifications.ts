import { useCallback, useEffect, useState } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import type { NotificationResponse } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type {
  NotificationDeviceResource,
  PushDeliveryResource,
  PushPreferences,
  VeraClient,
} from '@vera/client';
import { parseAttentionDeepLink } from './attention-deep-link.ts';

const INSTALLATION_KEY = 'vera.notificationInstallationId.v1';
let notificationModulePromise:
  | Promise<typeof import('expo-notifications')>
  | undefined;

async function loadNotificationModule() {
  notificationModulePromise ??= import('expo-notifications').then(
    (notifications) => {
      notifications.setNotificationHandler({
        handleNotification: () =>
          Promise.resolve({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
      });
      return notifications;
    },
  );
  return notificationModulePromise;
}

if (Platform.OS !== 'web') {
  void loadNotificationModule();
}

export type PushNotificationController = {
  loading: boolean;
  enabling: boolean;
  supported: boolean;
  explanation?: string;
  device?: NotificationDeviceResource;
  deliveries: PushDeliveryResource[];
  enable(): Promise<void>;
  update(preferences: PushPreferences): Promise<void>;
  sendTest(): Promise<void>;
  revoke(): Promise<void>;
  refresh(): Promise<void>;
};

export function usePushNotifications(options: {
  client: VeraClient;
  onAttention: (attentionItemId?: string) => void;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}): PushNotificationController {
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [supported, setSupported] = useState(Platform.OS !== 'web');
  const [explanation, setExplanation] = useState<string>();
  const [device, setDevice] = useState<NotificationDeviceResource>();
  const [deliveries, setDeliveries] = useState<PushDeliveryResource[]>([]);
  const { client, onAttention, onError, onRefresh } = options;

  const refresh = useCallback(async () => {
    try {
      const [status, devices, history] = await Promise.all([
        client.getPushNotificationStatus(),
        client.listNotificationDevices(),
        client.listPushDeliveries(),
      ]);
      const nativeSupported =
        Platform.OS !== 'web' &&
        Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
      setSupported(status.enabled && nativeSupported);
      setExplanation(
        !status.enabled
          ? 'Push delivery is disabled on this Vera server.'
          : Platform.OS === 'web'
            ? 'Install Vera on a phone to receive device notifications.'
            : !nativeSupported
              ? 'Remote notifications require a Vera development build; Expo Go does not include this native capability.'
              : undefined,
      );
      setDevice(
        devices.devices.find((item) => item.status === 'active') ??
          devices.devices[0],
      );
      setDeliveries(history.deliveries);
    } catch {
      setExplanation('Vera could not load device notification settings.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    let subscription: { remove(): void } | undefined;
    const handleResponse = (response: NotificationResponse) => {
      const target = parseAttentionDeepLink(
        response.notification.request.content.data?.deepLink,
      );
      if (target === null) return;
      onAttention(target.attentionItemId);
      void onRefresh();
    };
    void loadNotificationModule().then((notifications) => {
      if (!active) return;
      const initialResponse = notifications.getLastNotificationResponse();
      if (initialResponse !== null) handleResponse(initialResponse);
      const subscribe: (listener: (response: NotificationResponse) => void) => {
        remove(): void;
      } = notifications.addNotificationResponseReceivedListener;
      subscription = subscribe(handleResponse);
    });
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [onAttention, onRefresh]);

  async function enable() {
    if (!supported || enabling) return;
    setEnabling(true);
    try {
      if (!Device.isDevice)
        throw new Error('Push notifications require a physical device.');
      const notifications = await loadNotificationModule();
      if (Platform.OS === 'android')
        await notifications.setNotificationChannelAsync('vera-attention', {
          name: 'Vera attention',
          importance: notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 150, 250],
          lightColor: '#F3C94F',
        });
      let permissions = await notifications.getPermissionsAsync();
      if (!permissions.granted)
        permissions = await notifications.requestPermissionsAsync();
      if (!permissions.granted)
        throw new Error('Notification permission was not granted.');
      const status = await client.getPushNotificationStatus();
      const projectId = status.projectId ?? Constants.easConfig?.projectId;
      if (projectId === undefined)
        throw new Error('The Vera Expo project ID is not configured.');
      const pushToken = (
        await notifications.getExpoPushTokenAsync({ projectId })
      ).data;
      let installationId = await SecureStore.getItemAsync(INSTALLATION_KEY);
      if (installationId === null) {
        installationId = `installation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        await SecureStore.setItemAsync(INSTALLATION_KEY, installationId);
      }
      setDevice(
        await client.registerNotificationDevice({
          installationId,
          provider: 'expo',
          projectId,
          pushToken,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          name: Device.deviceName ?? `${Platform.OS} device`,
        }),
      );
      await refresh();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setEnabling(false);
    }
  }
  async function update(preferences: PushPreferences) {
    if (device === undefined) return;
    try {
      setDevice(
        await client.updateNotificationPreferences(device.id, preferences),
      );
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  async function sendTest() {
    if (device === undefined) return;
    try {
      await client.testNotificationDevice(
        device.id,
        `push-test-${Date.now().toString(36)}`,
      );
      await refresh();
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  async function revoke() {
    if (device === undefined) return;
    try {
      setDevice(await client.revokeNotificationDevice(device.id));
      await refresh();
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  return {
    loading,
    enabling,
    supported,
    ...(explanation === undefined ? {} : { explanation }),
    ...(device === undefined ? {} : { device }),
    deliveries,
    enable,
    update,
    sendTest,
    revoke,
    refresh,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Vera could not configure notifications.';
}
