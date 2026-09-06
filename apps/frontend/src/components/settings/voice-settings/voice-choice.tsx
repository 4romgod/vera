import { Check, CirclePlay, Sparkles, Square } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { palette, radius, spacing } from '@/design/tokens';
import type { DeviceVoice } from '@/voice/settings/voice-preferences';

export function VoiceChoice(props: {
  name: string;
  description: string;
  selected: boolean;
  recommended?: boolean;
  previewing?: boolean;
  previewLabel?: string;
  onPreview?: () => void;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'stretch',
        borderWidth: 1,
        borderColor: props.selected ? palette.accentLine : palette.lineSoft,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: props.selected
          ? palette.accentSurface
          : palette.canvas,
      }}
    >
      <Pressable
        accessibilityLabel={`${props.name}. ${props.description}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: props.selected }}
        onPress={props.onPress}
        style={({ pressed }) => ({
          minWidth: 0,
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          opacity: pressed ? 0.68 : 1,
        })}
      >
        <View
          style={{
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: props.selected ? palette.accent : palette.line,
            borderRadius: radius.pill,
            backgroundColor: props.selected
              ? palette.accentSurfaceStrong
              : palette.surface,
          }}
        >
          {props.selected ? (
            <Check color={palette.accentStrong} size={14} strokeWidth={2.5} />
          ) : null}
        </View>
        <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            <Text
              style={{ color: palette.text, fontSize: 13, fontWeight: '600' }}
            >
              {props.name}
            </Text>
            {props.recommended ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  borderRadius: radius.pill,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  backgroundColor: palette.accentSurfaceStrong,
                }}
              >
                <Sparkles color={palette.accentStrong} size={10} />
                <Text
                  style={{
                    color: palette.accentStrong,
                    fontSize: 9,
                    fontWeight: '700',
                  }}
                >
                  RECOMMENDED
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            selectable
            style={{ color: palette.muted, fontSize: 11, lineHeight: 16 }}
          >
            {props.description}
          </Text>
        </View>
      </Pressable>
      {props.onPreview === undefined ? null : (
        <Pressable
          accessibilityLabel={props.previewLabel ?? `Preview ${props.name}`}
          accessibilityRole="button"
          onPress={props.onPreview}
          style={({ pressed }) => ({
            width: 52,
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderLeftWidth: 1,
            borderLeftColor: palette.lineSoft,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {props.previewing ? (
            <Square
              color={palette.accentStrong}
              fill={palette.accentStrong}
              size={16}
            />
          ) : (
            <CirclePlay color={palette.textSoft} size={19} />
          )}
        </Pressable>
      )}
    </View>
  );
}

export function voiceDescription(voice: DeviceVoice): string {
  const attributes = [voice.language];
  if (voice.quality === 'Enhanced') attributes.push('Enhanced');
  if (voice.isDefault === true) attributes.push('Device default');
  if (voice.localService === false) attributes.push('May require network');
  return attributes.join(' · ');
}
