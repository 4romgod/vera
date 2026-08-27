import { Send } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

import {
  VoiceInputButton,
  VoiceInputStatus,
} from '@/components/voice-controls';
import { palette, radius, shadow, spacing } from '@/design/tokens';
import type { VoiceInputPhase } from '@/voice/use-voice-input';

export function MessageComposer(props: {
  compact: boolean;
  bottomInset: number;
  draft: string;
  draftFromVoice: boolean;
  busy: boolean;
  voicePhase: VoiceInputPhase;
  voiceDurationMs: number;
  onChange: (value: string) => void;
  onSend: () => void;
  onVoice: () => void;
  onVoiceSend: () => void;
}) {
  const recording = props.voicePhase === 'recording';
  const sendDisabled =
    props.busy ||
    (!recording &&
      (props.voicePhase !== 'idle' || props.draft.trim().length === 0));
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: palette.lineSoft,
        paddingHorizontal: props.compact ? spacing.md : spacing.xxl,
        paddingTop: spacing.md,
        paddingBottom: Math.max(props.bottomInset, spacing.md),
        backgroundColor: palette.canvasRaised,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 820,
          alignSelf: 'center',
          gap: spacing.sm,
        }}
      >
        <VoiceInputStatus
          phase={props.voicePhase}
          durationMs={props.voiceDurationMs}
          transcriptReady={
            props.draftFromVoice && props.draft.trim().length > 0
          }
        />
        <View
          style={{
            minHeight: 60,
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            borderWidth: 1,
            borderColor:
              props.voicePhase === 'recording' ? '#7B454B' : palette.line,
            borderCurve: 'continuous',
            borderRadius: radius.lg,
            padding: 7,
            backgroundColor: palette.surface,
            boxShadow: shadow.raised,
          }}
        >
          <TextInput
            accessibilityLabel="Message Vera"
            editable={props.voicePhase === 'idle'}
            multiline
            onChangeText={props.onChange}
            onSubmitEditing={props.onSend}
            placeholder="Message Vera"
            placeholderTextColor={palette.faint}
            style={{
              minHeight: 44,
              maxHeight: 150,
              minWidth: 0,
              flex: 1,
              paddingHorizontal: spacing.md,
              paddingVertical: 11,
              color: palette.text,
              fontSize: 16,
              lineHeight: 22,
              textAlignVertical: 'top',
            }}
            value={props.draft}
          />
          <VoiceInputButton
            disabled={props.busy}
            phase={props.voicePhase}
            onPress={props.onVoice}
          />
          <Pressable
            accessibilityLabel={
              recording
                ? 'Stop voice recording and send transcript'
                : 'Send message'
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: sendDisabled }}
            disabled={sendDisabled}
            onPress={recording ? props.onVoiceSend : props.onSend}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              opacity: sendDisabled ? 0.35 : pressed ? 0.72 : 1,
              backgroundColor: palette.accentSurfaceStrong,
            })}
          >
            <Send color={palette.accentStrong} size={19} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
