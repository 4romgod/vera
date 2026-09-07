import { Linking } from 'react-native';

import type { NotificationResource } from '@vera/client';

export async function openNotificationTarget(
  notification: NotificationResource,
): Promise<void> {
  const url =
    'externalSignalId' in notification
      ? notification.url
      : 'missionId' in notification
        ? notification.pullRequestUrl
        : undefined;
  if (url !== undefined) await Linking.openURL(url);
}
