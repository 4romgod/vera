import { useState } from 'react';
import { Trash2 } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { ConversationSummaryResource } from '@vera/client';

import { palette, radius, spacing } from '@/design/tokens';
import {
  displayConversationTitle,
  formatConversationTime,
} from './presentation.ts';

export function ConversationListItem(props: {
  conversation: ConversationSummaryResource;
  selected: boolean;
  supportsHover: boolean;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const actionsVisible = !props.supportsHover || hovered || focused;
  const title = displayConversationTitle(props.conversation.title, 54);

  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        minHeight: 64,
        borderWidth: 1,
        borderColor: props.selected ? palette.accentLine : 'transparent',
        borderRadius: radius.md,
        backgroundColor: props.selected
          ? palette.accentSurface
          : hovered
            ? palette.surface
            : 'transparent',
      }}
    >
      <Pressable
        accessibilityLabel={`Open conversation ${title}`}
        accessibilityRole="button"
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={props.onSelect}
        style={({ pressed }) => ({
          minHeight: 62,
          justifyContent: 'center',
          gap: 5,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 10,
          paddingRight: 46,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              minWidth: 0,
              flex: 1,
              color: props.selected ? palette.text : palette.textSoft,
              fontSize: 13,
              fontWeight: props.selected ? '600' : '500',
            }}
          >
            {title}
          </Text>
          <Text
            selectable
            style={{
              color: palette.faint,
              fontSize: 10,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatConversationTime(props.conversation.updatedAt)}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 11 }}>
          {props.conversation.lastMessage?.content ??
            `${String(props.conversation.messageCount)} messages`}
        </Text>
      </Pressable>
      <View
        pointerEvents={actionsVisible ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 7,
          right: 9,
          width: 30,
          height: 30,
          opacity: actionsVisible ? 1 : 0,
        }}
      >
        <Pressable
          accessibilityLabel={`Delete conversation ${title}`}
          accessibilityRole="button"
          hitSlop={7}
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onPress={props.onDelete}
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.sm,
            opacity: pressed ? 0.65 : 1,
            backgroundColor: pressed ? palette.dangerSurface : palette.surface,
          })}
        >
          <Trash2 color={palette.danger} size={15} strokeWidth={1.8} />
        </Pressable>
      </View>
    </View>
  );
}
