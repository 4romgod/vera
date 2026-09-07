import { AudioLines, BellRing, PlugZap } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { palette, radius, spacing } from '@/design/tokens';

export type SettingsSection = 'voice' | 'connections' | 'notifications';

export const settingsSections = [
  {
    id: 'voice',
    label: 'Voice',
    description: 'Speech and playback',
    icon: AudioLines,
  },
  {
    id: 'connections',
    label: 'Connections',
    description: 'External services',
    icon: PlugZap,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Device alerts',
    icon: BellRing,
  },
] as const;

export function parseSettingsSection(value: unknown): SettingsSection {
  const first = Array.isArray(value) ? (value as unknown[])[0] : undefined;
  const candidate = typeof value === 'string' ? value : first;
  return settingsSections.some((section) => section.id === candidate)
    ? (candidate as SettingsSection)
    : 'voice';
}

export function SettingsNavigation(props: {
  compact: boolean;
  selected: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const tabs = settingsSections.map((item) => {
    const Icon = item.icon;
    const selected = props.selected === item.id;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        key={item.id}
        onPress={() => props.onSelect(item.id)}
        style={({ pressed }) => ({
          width: props.compact ? undefined : '100%',
          minWidth: 0,
          minHeight: 62,
          flex: props.compact ? 1 : undefined,
          flexDirection: props.compact ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: props.compact ? 'center' : undefined,
          gap: props.compact ? spacing.xs : spacing.md,
          borderWidth: 1,
          borderColor: selected ? palette.accentLine : 'transparent',
          borderRadius: radius.md,
          paddingHorizontal: props.compact ? spacing.xs : spacing.md,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.68 : 1,
          backgroundColor: selected ? palette.accentSurface : 'transparent',
        })}
      >
        <View
          style={{
            width: props.compact ? 30 : 34,
            height: props.compact ? 30 : 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.sm,
            backgroundColor: selected
              ? palette.accentSurfaceStrong
              : palette.surface,
          }}
        >
          <Icon
            color={selected ? palette.accentStrong : palette.muted}
            size={18}
          />
        </View>
        <View
          style={{
            minWidth: 0,
            flex: props.compact ? undefined : 1,
            alignItems: props.compact ? 'center' : undefined,
            gap: 2,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: selected ? palette.text : palette.textSoft,
              fontSize: props.compact ? 11 : 13,
              fontWeight: '700',
            }}
          >
            {item.label}
          </Text>
          {props.compact ? null : (
            <Text
              numberOfLines={1}
              style={{ color: palette.faint, fontSize: 10 }}
            >
              {item.description}
            </Text>
          )}
        </View>
      </Pressable>
    );
  });

  if (props.compact) {
    return (
      <View
        accessibilityRole="tablist"
        style={{
          width: '100%',
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
        }}
      >
        {tabs}
      </View>
    );
  }
  return (
    <View accessibilityRole="tablist" style={{ width: 220, gap: spacing.xs }}>
      {tabs}
    </View>
  );
}
