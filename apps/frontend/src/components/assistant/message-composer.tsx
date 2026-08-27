import { FileText, Paperclip, RefreshCw, Send, X } from 'lucide-react-native';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  VoiceInputButton,
  VoiceInputStatus,
} from '@/components/voice-controls';
import { palette, radius, shadow, spacing } from '@/design/tokens';
import type { VoiceInputPhase } from '@/voice/use-voice-input';
import type { AttachmentReference } from '@vera/client';

export type ComposerAttachment = {
  localId: string;
  filename: string;
  mediaType: AttachmentReference['mediaType'];
  byteLength: number;
  status: 'uploading' | 'ready' | 'failed';
  resource?: AttachmentReference;
  previewUri?: string;
  error?: string;
};

export function MessageComposer(props: {
  compact: boolean;
  bottomInset: number;
  draft: string;
  draftFromVoice: boolean;
  busy: boolean;
  voicePhase: VoiceInputPhase;
  voiceDurationMs: number;
  attachments: ComposerAttachment[];
  attaching: boolean;
  onAttach: () => void;
  onRemoveAttachment: (localId: string) => void;
  onRetryAttachment: (localId: string) => void;
  onChange: (value: string) => void;
  onSend: () => void;
  onVoice: () => void;
  onVoiceSend: () => void;
}) {
  const recording = props.voicePhase === 'recording';
  const sendDisabled =
    props.busy ||
    props.attachments.some((attachment) => attachment.status !== 'ready') ||
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
        {props.attachments.length === 0 ? null : (
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {props.attachments.map((attachment) => (
              <View
                key={attachment.localId}
                style={{
                  maxWidth: '100%',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  borderWidth: 1,
                  borderColor:
                    attachment.status === 'failed' ? '#7B454B' : palette.line,
                  borderRadius: radius.md,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor: palette.surface,
                }}
              >
                {attachment.previewUri !== undefined ? (
                  <Image
                    accessibilityLabel={`Preview of ${attachment.filename}`}
                    contentFit="cover"
                    source={attachment.previewUri}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: radius.sm,
                    }}
                  />
                ) : attachment.status === 'uploading' ? (
                  <ActivityIndicator color={palette.accent} size="small" />
                ) : (
                  <FileText color={palette.accent} size={15} />
                )}
                <View style={{ minWidth: 0, flexShrink: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: palette.text,
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {attachment.filename}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color:
                        attachment.status === 'failed'
                          ? '#F4A9B0'
                          : palette.muted,
                      fontSize: 10,
                    }}
                  >
                    {attachment.status === 'uploading'
                      ? 'Processing file…'
                      : attachment.status === 'failed'
                        ? (attachment.error ?? 'Upload failed')
                        : `${String(Math.ceil(attachment.byteLength / 1024))} KB · ready`}
                  </Text>
                </View>
                {attachment.status === 'failed' ? (
                  <Pressable
                    accessibilityLabel={`Retry ${attachment.filename}`}
                    accessibilityRole="button"
                    onPress={() => props.onRetryAttachment(attachment.localId)}
                  >
                    <RefreshCw color={palette.accent} size={15} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityLabel={`Remove ${attachment.filename}`}
                  accessibilityRole="button"
                  onPress={() => props.onRemoveAttachment(attachment.localId)}
                >
                  <X color={palette.muted} size={16} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
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
          <Pressable
            accessibilityLabel="Attach a file"
            accessibilityRole="button"
            disabled={
              props.busy || props.attaching || props.attachments.length >= 5
            }
            onPress={props.onAttach}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              opacity:
                props.attaching || props.attachments.length >= 5
                  ? 0.35
                  : pressed
                    ? 0.72
                    : 1,
              backgroundColor: palette.canvasRaised,
            })}
          >
            {props.attaching ? (
              <ActivityIndicator color={palette.accent} size="small" />
            ) : (
              <Paperclip color={palette.textSoft} size={19} />
            )}
          </Pressable>
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
