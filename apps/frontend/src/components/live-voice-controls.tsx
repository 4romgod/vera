import { AudioLines, Square } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { palette, radius, spacing } from '@/design/tokens';
import type { LiveVoicePhase } from '@/voice/use-live-voice';

const labels: Record<LiveVoicePhase, string> = {
  idle: 'Live',
  connecting: 'Connecting securely…',
  listening: 'Listening — take your time',
  hearing: 'I hear you…',
  thinking: 'Thinking…',
  speaking: 'Speaking — interrupt anytime',
  reconnecting: 'Reconnecting…',
  stopping: 'Ending…',
};

export function LiveVoiceControls(props: {
  available?: boolean;
  phase: LiveVoicePhase;
  transcript?: string;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const active = props.phase !== 'idle';
  const working = ['connecting', 'reconnecting', 'stopping'].includes(
    props.phase,
  );
  if (!active) {
    return (
      <Pressable
        accessibilityLabel={
          props.available === false
            ? 'Live conversation is unavailable'
            : 'Start live conversation'
        }
        accessibilityRole="button"
        accessibilityState={{
          disabled: props.disabled || props.available !== true,
        }}
        disabled={props.disabled || props.available !== true}
        onPress={props.onStart}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          borderWidth: 1,
          borderColor: palette.line,
          borderRadius: radius.pill,
          paddingHorizontal: 12,
          paddingVertical: 7,
          backgroundColor: palette.surface,
          opacity:
            props.disabled || props.available !== true
              ? 0.45
              : pressed
                ? 0.72
                : 1,
        })}
      >
        <AudioLines color={palette.accent} size={15} />
        <Text
          style={{ color: palette.textSoft, fontSize: 12, fontWeight: '700' }}
        >
          {props.available === undefined
            ? 'Checking live voice…'
            : props.available
              ? 'Start live conversation'
              : 'Live voice unavailable'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: palette.accentLine,
        borderRadius: radius.md,
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: palette.accentSurface,
      }}
    >
      {working ? (
        <ActivityIndicator color={palette.accent} size="small" />
      ) : (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor:
              props.phase === 'hearing' ? palette.danger : palette.accent,
          }}
        />
      )}
      <View style={{ minWidth: 0, flex: 1 }}>
        <Text style={{ color: palette.text, fontSize: 12, fontWeight: '700' }}>
          {labels[props.phase]}
        </Text>
        {props.transcript === undefined ? null : (
          <Text
            numberOfLines={1}
            style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}
          >
            {props.transcript}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityLabel="End live conversation"
        accessibilityRole="button"
        disabled={props.phase === 'stopping'}
        onPress={props.onStop}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.sm,
          backgroundColor: palette.dangerSurface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Square color={palette.danger} fill={palette.danger} size={12} />
      </Pressable>
    </View>
  );
}
