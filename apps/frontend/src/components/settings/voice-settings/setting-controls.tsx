import { useEffect, useState, type ReactNode } from 'react';
import Slider from '@react-native-community/slider';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { palette, radius, spacing } from '@/design/tokens';

export function SettingCard(props: { children: ReactNode }) {
  return (
    <View
      style={{
        gap: spacing.lg,
        borderWidth: 1,
        borderColor: palette.lineSoft,
        borderRadius: radius.lg,
        padding: spacing.lg,
        backgroundColor: palette.surface,
      }}
    >
      {props.children}
    </View>
  );
}

export function SettingHeading(props: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <View style={{ minWidth: 0, flex: 1, gap: 5 }}>
      <Text
        selectable
        style={{
          color: palette.accent,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
        }}
      >
        {props.eyebrow}
      </Text>
      <Text
        selectable
        style={{ color: palette.text, fontSize: 16, fontWeight: '700' }}
      >
        {props.title}
      </Text>
      <Text
        selectable
        style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}
      >
        {props.description}
      </Text>
    </View>
  );
}

export function RangeSetting(props: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  minimum: number;
  maximum: number;
  step: number;
  value: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(props.value);
  useEffect(() => setDraftValue(props.value), [props.value]);
  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{ color: palette.textSoft, fontSize: 13, fontWeight: '600' }}
        >
          {props.label}
        </Text>
        <Text
          selectable
          style={{
            color: palette.accentStrong,
            fontSize: 12,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatRangeValue(draftValue, props.valueLabel)}
        </Text>
      </View>
      <Slider
        accessibilityLabel={props.label}
        maximumTrackTintColor={palette.line}
        maximumValue={props.maximum}
        minimumTrackTintColor={palette.accent}
        minimumValue={props.minimum}
        onSlidingComplete={props.onChange}
        onValueChange={setDraftValue}
        step={props.step}
        style={{ width: '100%', height: 40 }}
        thumbTintColor={palette.accentStrong}
        value={draftValue}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: palette.faint, fontSize: 10 }}>
          {props.leftLabel}
        </Text>
        <Text style={{ color: palette.faint, fontSize: 10 }}>
          {props.rightLabel}
        </Text>
      </View>
    </View>
  );
}

export function ActionButton(props: {
  icon?: LucideIcon;
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: props.primary ? palette.accentLine : palette.line,
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        opacity: pressed ? 0.68 : 1,
        backgroundColor: props.primary
          ? palette.accentSurfaceStrong
          : palette.surfaceRaised,
      })}
    >
      {Icon === undefined ? null : (
        <Icon
          color={props.primary ? palette.accentStrong : palette.textSoft}
          size={17}
        />
      )}
      <Text
        style={{
          color: props.primary ? palette.accentStrong : palette.textSoft,
          fontSize: 12,
          fontWeight: '600',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function formatRangeValue(value: number, example: string): string {
  return `${value.toFixed(2)}${example.endsWith('×') ? '×' : ''}`;
}
