import { BellRing, Clock3, Send, Smartphone, X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import type { PushPreferences } from '@vera/client';
import type { PushNotificationController } from '@/notifications/use-push-notifications';
import { palette, radius, spacing } from '@/design/tokens';

const categories: {
  key: keyof Omit<PushPreferences, 'quietHours'>;
  label: string;
}[] = [
  { key: 'approvals', label: 'Approvals' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'tasks', label: 'Due tasks' },
  { key: 'failures', label: 'Failures' },
  { key: 'results', label: 'Ready results' },
];
export function NotificationSettings({
  controller,
}: {
  controller: PushNotificationController;
}) {
  const device = controller.device;
  return (
    <View
      style={{
        gap: spacing.md,
        borderWidth: 1,
        borderColor: palette.line,
        borderRadius: radius.lg,
        padding: spacing.lg,
        backgroundColor: palette.surface,
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        <Smartphone color={palette.accent} size={18} />
        <Text
          style={{
            color: palette.text,
            fontSize: 17,
            fontWeight: '700',
            flex: 1,
          }}
        >
          On-device alerts
        </Text>
      </View>
      <Text style={{ color: palette.textSoft, lineHeight: 20 }}>
        Vera sends privacy-safe alerts when something actually needs you.
        Message content stays inside the app.
      </Text>
      {controller.explanation === undefined ? null : (
        <Text style={{ color: palette.muted, lineHeight: 19 }}>
          {controller.explanation}
        </Text>
      )}
      {device?.status === 'active' ? (
        <>
          <Text
            style={{ color: palette.accent, fontSize: 12, fontWeight: '700' }}
          >
            {device.name} · ACTIVE
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {categories.map(({ key, label }) => {
              const selected = device.preferences[key];
              return (
                <Pressable
                  key={key}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: selected }}
                  onPress={() =>
                    void controller.update({
                      ...device.preferences,
                      [key]: !selected,
                    })
                  }
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? palette.accentLine : palette.line,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: selected
                      ? palette.accentSurface
                      : palette.canvas,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? palette.accent : palette.muted,
                      fontWeight: '600',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Action
            icon={Clock3}
            label={
              device.preferences.quietHours === undefined
                ? 'Quiet overnight (22:00–07:00)'
                : `Quiet ${device.preferences.quietHours.startLocalTime}–${device.preferences.quietHours.endLocalTime} · On`
            }
            onPress={() => {
              if (device.preferences.quietHours === undefined) {
                void controller.update({
                  ...device.preferences,
                  quietHours: {
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    startLocalTime: '22:00',
                    endLocalTime: '07:00',
                  },
                });
              } else {
                const { quietHours: ignored, ...withoutQuietHours } =
                  device.preferences;
                void ignored;
                void controller.update(withoutQuietHours);
              }
            }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Action
              icon={Send}
              label="Send test"
              onPress={() => void controller.sendTest()}
            />
            <Action
              icon={X}
              label="Disable"
              onPress={() => void controller.revoke()}
            />
          </View>
        </>
      ) : (
        <Action
          disabled={
            controller.loading || !controller.supported || controller.enabling
          }
          icon={BellRing}
          label={
            controller.loading
              ? 'Checking availability…'
              : controller.enabling
                ? 'Enabling…'
                : 'Enable alerts'
          }
          onPress={() => void controller.enable()}
        />
      )}
      {controller.deliveries.slice(0, 3).map((delivery) => (
        <Text key={delivery.id} style={{ color: palette.faint, fontSize: 11 }}>
          {delivery.category} · {delivery.status} ·{' '}
          {new Date(delivery.updatedAt).toLocaleString()}
        </Text>
      ))}
    </View>
  );
}
function Action(props: {
  icon: typeof BellRing;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: palette.line,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        opacity: props.disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Icon color={palette.textSoft} size={16} />
      <Text style={{ color: palette.textSoft, fontWeight: '700' }}>
        {props.label}
      </Text>
    </Pressable>
  );
}
