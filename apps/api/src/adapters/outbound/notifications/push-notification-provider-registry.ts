import type { PushNotificationProvider } from '../../../ports/notifications/push-notification-provider.ts';
import { DeterministicPushNotificationProvider } from './deterministic-push-notification-provider.ts';
import { ExpoPushNotificationProvider } from './expo-push-notification-provider.ts';

export type PushProviderConfig =
  | { adapterId: 'disabled' }
  | { adapterId: 'deterministic' }
  | {
      adapterId: 'expo';
      baseUrl: string;
      accessToken?: string;
      timeoutMs: number;
      projectId: string;
    };

export function createPushNotificationProvider(
  config: PushProviderConfig,
): PushNotificationProvider | undefined {
  if (config.adapterId === 'disabled') return undefined;
  if (config.adapterId === 'deterministic')
    return new DeterministicPushNotificationProvider();
  return new ExpoPushNotificationProvider(config);
}
