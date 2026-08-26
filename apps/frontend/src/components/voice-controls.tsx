import { Mic, Square, Volume2, VolumeX } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import type { VoiceInputPhase } from '@/voice/use-voice-input';
import { palette, radius, spacing } from '@/design/tokens';

export function VoiceInputButton(props: {
  disabled: boolean;
  phase: VoiceInputPhase;
  onPress: () => void;
}) {
  const working =
    props.phase === 'requesting_permission' || props.phase === 'finishing';
  const listening = props.phase === 'listening';
  return (
    <Pressable
      accessibilityLabel={listening ? 'Stop voice input' : 'Start voice input'}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled, selected: listening }}
      disabled={props.disabled || working}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: listening ? palette.danger : 'transparent',
        borderCurve: 'continuous',
        borderRadius: radius.md,
        opacity: props.disabled ? 0.35 : pressed ? 0.7 : 1,
        backgroundColor: listening
          ? palette.dangerSurface
          : palette.surfaceStrong,
      })}
    >
      {working ? (
        <ActivityIndicator color={palette.accent} size="small" />
      ) : listening ? (
        <Square color={palette.danger} fill={palette.danger} size={14} />
      ) : (
        <Mic color={palette.textSoft} size={20} strokeWidth={1.9} />
      )}
    </Pressable>
  );
}

export function VoiceInputStatus(props: {
  phase: VoiceInputPhase;
  transcriptReady: boolean;
}) {
  if (props.phase === 'idle' && !props.transcriptReady) return null;
  const message =
    props.phase === 'requesting_permission'
      ? 'Preparing the microphone…'
      : props.phase === 'listening'
        ? 'Listening… Tap stop when you are finished.'
        : props.phase === 'finishing'
          ? 'Finishing the transcript…'
          : 'Transcript ready. Review or edit it before sending.';
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          backgroundColor:
            props.phase === 'listening' ? palette.danger : palette.accent,
        }}
      />
      <Text
        selectable
        style={{
          minWidth: 0,
          flex: 1,
          color: palette.muted,
          fontSize: 11,
          lineHeight: 16,
        }}
      >
        {message} Audio stays with your device speech service.
      </Text>
    </View>
  );
}

export function SpokenReplyButton(props: {
  speaking: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.speaking ? 'Stop speaking' : 'Read reply aloud'}
      accessibilityRole="button"
      accessibilityState={{ selected: props.speaking }}
      hitSlop={8}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: radius.sm,
        paddingHorizontal: 8,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      {props.speaking ? (
        <VolumeX color={palette.danger} size={15} />
      ) : (
        <Volume2 color={palette.muted} size={15} />
      )}
      <Text
        style={{
          color: props.speaking ? palette.danger : palette.muted,
          fontSize: 11,
        }}
      >
        {props.speaking ? 'Stop audio' : 'Read aloud'}
      </Text>
    </Pressable>
  );
}
