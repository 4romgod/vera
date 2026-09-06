import * as Clipboard from 'expo-clipboard';
import { Check, Copy as CopyIcon, TriangleAlert } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SpokenReplyButton } from '@/components/voice-controls';
import { palette, radius, spacing } from '@/design/tokens';
import { formatMessageTimestamp } from './presentation.ts';

type CopyState = 'idle' | 'copied' | 'failed';

export function MessageActions(props: {
  content: string;
  createdAt: string;
  owner: boolean;
  speaking: boolean;
  visible: boolean;
  onSpeak: () => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const timestamp = formatMessageTimestamp(props.createdAt);

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyMessage() {
    try {
      await Clipboard.setStringAsync(props.content);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState('idle'), 1800);
  }

  const CopyStateIcon =
    copyState === 'copied'
      ? Check
      : copyState === 'failed'
        ? TriangleAlert
        : CopyIcon;
  const copyLabel =
    copyState === 'copied'
      ? 'Copied'
      : copyState === 'failed'
        ? 'Copy failed'
        : 'Copy';
  const copyColor =
    copyState === 'copied'
      ? palette.accent
      : copyState === 'failed'
        ? palette.danger
        : palette.muted;

  return (
    <View
      accessibilityElementsHidden={!props.visible}
      importantForAccessibility={props.visible ? 'auto' : 'no-hide-descendants'}
      style={{
        minHeight: 36,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: props.owner ? 'flex-end' : 'flex-start',
        gap: spacing.xs,
        opacity: props.visible ? 1 : 0,
        pointerEvents: props.visible ? 'auto' : 'none',
      }}
    >
      <Pressable
        accessibilityLabel={
          copyState === 'copied'
            ? 'Message copied'
            : copyState === 'failed'
              ? 'Message copy failed. Try again'
              : 'Copy message'
        }
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          void copyMessage();
        }}
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
        <CopyStateIcon color={copyColor} size={14} strokeWidth={1.9} />
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: copyColor, fontSize: 11 }}
        >
          {copyLabel}
        </Text>
      </Pressable>
      {!props.owner ? (
        <SpokenReplyButton speaking={props.speaking} onPress={props.onSpeak} />
      ) : null}
      {timestamp.length === 0 ? null : (
        <Text
          accessibilityLabel={`Sent ${new Date(props.createdAt).toLocaleString()}`}
          selectable
          style={{
            color: palette.faint,
            fontSize: 11,
            fontVariant: ['tabular-nums'],
            paddingHorizontal: 6,
          }}
        >
          {timestamp}
        </Text>
      )}
    </View>
  );
}
