import { useDeferredValue, useMemo, useState } from 'react';
import {
  Bell,
  Brain,
  CircleAlert,
  ListChecks,
  MessageSquarePlus,
  Search,
  X,
} from 'lucide-react-native';
import {
  Modal,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConversationSummaryResource } from '@vera/client';

import type { ResourceTab } from '@/components/resource-panel';
import { IconButton } from '@/components/ui/icon-button';
import { layout, palette, radius, shadow, spacing } from '@/design/tokens';
import {
  displayConversationTitle,
  filterConversations,
  formatConversationTime,
  groupConversations,
} from './presentation';

export function ConversationSidebar(props: {
  compact: boolean;
  open: boolean;
  conversationId?: string;
  conversations: ConversationSummaryResource[];
  attention: number;
  memories: number;
  tasks: number;
  notifications: number;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onOpenResources: (tab: ResourceTab) => void;
}) {
  const content = <SidebarContent {...props} />;
  if (!props.compact) return content;
  return (
    <Modal
      animationType="fade"
      onRequestClose={props.onClose}
      transparent
      visible={props.open}
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          flexDirection: 'row',
          backgroundColor: palette.scrim,
        }}
      >
        {content}
        <Pressable
          accessibilityLabel="Close conversations"
          accessibilityRole="button"
          onPress={props.onClose}
          style={{ flex: 1 }}
        />
      </View>
    </Modal>
  );
}

function SidebarContent(props: Parameters<typeof ConversationSidebar>[0]) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const groups = useMemo(
    () =>
      groupConversations(
        filterConversations(props.conversations, deferredQuery),
      ),
    [deferredQuery, props.conversations],
  );
  return (
    <View
      style={{
        width: props.compact ? '88%' : layout.sidebarWidth,
        maxWidth: 370,
        height: '100%',
        borderRightWidth: 1,
        borderRightColor: palette.lineSoft,
        paddingTop: props.compact
          ? Math.max(insets.top, spacing.md)
          : spacing.lg,
        paddingBottom: props.compact
          ? Math.max(insets.bottom, spacing.md)
          : spacing.lg,
        backgroundColor: palette.canvasRaised,
        boxShadow: props.compact ? shadow.floating : undefined,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
        }}
      >
        <View style={{ gap: 2 }}>
          <Text
            selectable
            style={{
              color: palette.text,
              fontSize: 22,
              fontWeight: '700',
              letterSpacing: -0.5,
            }}
          >
            Conversations
          </Text>
          <Text selectable style={{ color: palette.muted, fontSize: 12 }}>
            Your ongoing work with Vera
          </Text>
        </View>
        {props.compact ? (
          <IconButton
            icon={X}
            label="Close conversations"
            onPress={props.onClose}
          />
        ) : null}
      </View>

      <View
        style={{
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={props.onNew}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            borderRadius: radius.md,
            opacity: pressed ? 0.75 : 1,
            backgroundColor: palette.accentSurfaceStrong,
          })}
        >
          <MessageSquarePlus
            color={palette.accentStrong}
            size={19}
            strokeWidth={1.9}
          />
          <Text
            style={{ color: palette.text, fontSize: 14, fontWeight: '600' }}
          >
            New conversation
          </Text>
        </Pressable>
        <View
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            borderWidth: 1,
            borderColor: palette.lineSoft,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            backgroundColor: palette.surface,
          }}
        >
          <Search color={palette.faint} size={17} strokeWidth={1.8} />
          <TextInput
            accessibilityLabel="Search conversations"
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={palette.faint}
            style={{
              minWidth: 0,
              flex: 1,
              color: palette.textSoft,
              fontSize: 14,
              paddingVertical: 10,
            }}
            value={query}
          />
        </View>
      </View>

      <SectionList
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: spacing.sm,
          paddingBottom: spacing.md,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        sections={groups.map((group) => ({
          title: group.label,
          data: group.conversations,
        }))}
        ListEmptyComponent={
          <Text
            selectable
            style={{
              padding: spacing.xxl,
              color: palette.muted,
              textAlign: 'center',
            }}
          >
            {query.trim().length > 0
              ? 'No matching conversations'
              : 'Start your first conversation'}
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text
            selectable
            style={{
              paddingHorizontal: spacing.md,
              paddingTop: spacing.md,
              paddingBottom: spacing.sm,
              color: palette.faint,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 0.8,
            }}
          >
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => {
          const selected = props.conversationId === item.id;
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onSelect(item.id)}
              style={({ pressed }) => ({
                minHeight: 64,
                gap: 5,
                borderWidth: 1,
                borderColor: selected ? palette.accentLine : 'transparent',
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: 10,
                opacity: pressed ? 0.7 : 1,
                backgroundColor: selected
                  ? palette.accentSurface
                  : 'transparent',
              })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    color: selected ? palette.text : palette.textSoft,
                    fontSize: 13,
                    fontWeight: selected ? '600' : '500',
                  }}
                >
                  {displayConversationTitle(item.title, 54)}
                </Text>
                <Text
                  selectable
                  style={{
                    color: palette.faint,
                    fontSize: 10,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatConversationTime(item.updatedAt)}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={{ color: palette.muted, fontSize: 11 }}
              >
                {item.lastMessage?.content ??
                  `${String(item.messageCount)} messages`}
              </Text>
            </Pressable>
          );
        }}
      />

      <View
        style={{
          gap: spacing.xs,
          borderTopWidth: 1,
          borderTopColor: palette.lineSoft,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
        }}
      >
        <ResourceLink
          icon={CircleAlert}
          label="Today"
          count={props.attention}
          onPress={() => props.onOpenResources('attention')}
        />
        <ResourceLink
          icon={Brain}
          label="Memory"
          count={props.memories}
          onPress={() => props.onOpenResources('memory')}
        />
        <ResourceLink
          icon={ListChecks}
          label="Tasks"
          count={props.tasks}
          onPress={() => props.onOpenResources('tasks')}
        />
        <ResourceLink
          icon={Bell}
          label="Activity"
          count={props.notifications}
          onPress={() => props.onOpenResources('notifications')}
        />
      </View>
    </View>
  );
}

function ResourceLink(props: {
  icon: typeof Brain;
  label: string;
  count: number;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityLabel={`${props.label} ${String(props.count)}`}
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Icon color={palette.muted} size={18} strokeWidth={1.8} />
      <Text style={{ flex: 1, color: palette.textSoft, fontSize: 13 }}>
        {props.label}
      </Text>
      <Text
        style={{
          color: palette.faint,
          fontSize: 11,
          fontVariant: ['tabular-nums'],
        }}
      >
        {props.count}
      </Text>
    </Pressable>
  );
}
