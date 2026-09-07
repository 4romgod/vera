import type { VeraClient } from '@vera/client';

import { NotificationSettings } from '@/components/notifications/notification-settings';
import { usePushNotifications } from '@/notifications/use-push-notifications';

const ignoreRefresh = () => Promise.resolve();

export function NotificationSettingsTab(props: {
  client: VeraClient;
  onAttention: () => void;
  onError: (message: string) => void;
}) {
  const notifications = usePushNotifications({
    client: props.client,
    onAttention: props.onAttention,
    onRefresh: ignoreRefresh,
    onError: props.onError,
  });
  return <NotificationSettings controller={notifications} />;
}
