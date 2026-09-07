import { useDeferredValue, useMemo, useState } from 'react';
import {
  Bell,
  Brain,
  CircleAlert,
  ListChecks,
  MessageSquarePlus,
  Search,
  Settings2,
  X,
} from 'lucide-react-native';
import {
  Modal,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConversationSummaryResource } from '@vera/client';

import type { ResourceTab } from '@/components/resource-panel';
import { PanelResizeHandle } from '@/components/layout/panel-resize-handle';
import { useHoverCapability } from '@/components/layout/use-hover-capability';
import { IconButton } from '@/components/ui/icon-button';
import { palette, radius, shadow, spacing } from '@/design/tokens';
import { ConversationDeleteDialog } from './conversation-delete-dialog.tsx';
import { ConversationListItem } from './conversation-list-item.tsx';
import { filterConversations, groupConversations } from './presentation.ts';

const webTextInputReset =
  process.env.EXPO_OS === 'web'
    ? ({ outlineStyle: 'none' } as unknown as TextStyle)
    : undefined;

export function ConversationSidebar(props: {
  compact: boolean;
  open: boolean;
  conversationId?: string;
  conversations: ConversationSummaryResource[];
  attention: number;
  memories: number;
  tasks: number;
  notifications: number;
  width: number;
  minimumWidth: number;
  maximumWidth: number;
  onClose: () => void;
  onDelete: (id: string) => Promise<boolean>;
  onNew: () => void;
  onSelect: (id: string) => void;
  onOpenResources: (tab: ResourceTab) => void;
  onOpenSettings: () => void;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
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
  const [pendingDeletion, setPendingDeletion] =
    useState<ConversationSummaryResource>();
  const [deleting, setDeleting] = useState(false);
  const supportsHover = useHoverCapability();
  const deferredQuery = useDeferredValue(query);
  const groups = useMemo(
    () =>
      groupConversations(
        filterConversations(props.conversations, deferredQuery),
      ),
    [deferredQuery, props.conversations],
  );
  async function deleteConversation(): Promise<void> {
    if (pendingDeletion === undefined || deleting) return;
    setDeleting(true);
    await props.onDelete(pendingDeletion.id);
    setDeleting(false);
    setPendingDeletion(undefined);
  }

  return (
    <View
      style={{
        width: props.compact ? '88%' : props.width,
        maxWidth: props.compact ? 370 : props.maximumWidth,
        flexShrink: 0,
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
      {props.compact ? null : (
        <PanelResizeHandle
          edge="right"
          maximumWidth={props.maximumWidth}
          minimumWidth={props.minimumWidth}
          width={props.width}
          onResize={props.onResize}
          onResizeEnd={props.onResizeEnd}
        />
      )}
      <SectionList
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: spacing.sm,
          paddingBottom: spacing.md,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <SidebarHeader compact={props.compact} onClose={props.onClose} />
            <ConversationActions
              query={query}
              onNew={props.onNew}
              onQueryChange={setQuery}
            />
            <SidebarNavigation {...props} />
            <SidebarSectionLabel>PAST CONVERSATIONS</SidebarSectionLabel>
          </View>
        }
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
        renderItem={({ item }) => (
          <ConversationListItem
            conversation={item}
            selected={props.conversationId === item.id}
            supportsHover={supportsHover}
            onDelete={() => setPendingDeletion(item)}
            onSelect={() => props.onSelect(item.id)}
          />
        )}
        stickySectionHeadersEnabled={false}
        style={{ flex: 1 }}
      />
      <ConversationDeleteDialog
        conversation={pendingDeletion}
        deleting={deleting}
        onCancel={() => setPendingDeletion(undefined)}
        onConfirm={() => void deleteConversation()}
      />
    </View>
  );
}

function SidebarHeader(props: { compact: boolean; onClose: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.lg,
      }}
    >
      <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
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
  );
}

function ConversationActions(props: {
  query: string;
  onNew: () => void;
  onQueryChange: (query: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        gap: spacing.md,
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.xl,
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
        <Text style={{ color: palette.text, fontSize: 14, fontWeight: '600' }}>
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
          borderColor: focused ? palette.accent : palette.lineSoft,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          backgroundColor: focused ? palette.surfaceRaised : palette.surface,
          boxShadow: focused ? `0 0 0 2px ${palette.accentGlow}` : undefined,
        }}
      >
        <Search color={palette.faint} size={17} strokeWidth={1.8} />
        <TextInput
          accessibilityLabel="Search conversations"
          cursorColor={palette.accent}
          onBlur={() => setFocused(false)}
          onChangeText={props.onQueryChange}
          onFocus={() => setFocused(true)}
          placeholder="Search conversations"
          placeholderTextColor={palette.faint}
          style={[
            {
              minWidth: 0,
              flex: 1,
              borderWidth: 0,
              color: palette.textSoft,
              fontSize: 14,
              paddingVertical: 10,
              outlineWidth: 0,
              backgroundColor: 'transparent',
            },
            webTextInputReset,
          ]}
          selectionColor={palette.accent}
          underlineColorAndroid="transparent"
          value={props.query}
        />
      </View>
    </View>
  );
}

function SidebarNavigation(props: Parameters<typeof ConversationSidebar>[0]) {
  return (
    <View style={{ gap: spacing.xs, paddingBottom: spacing.lg }}>
      <SidebarSectionLabel>YOUR VERA</SidebarSectionLabel>
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
      <ResourceLink
        icon={Settings2}
        label="Settings"
        onPress={props.onOpenSettings}
      />
    </View>
  );
}

function SidebarSectionLabel(props: { children: string }) {
  return (
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
      {props.children}
    </Text>
  );
}

function ResourceLink(props: {
  icon: typeof Brain;
  label: string;
  count?: number;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityLabel={
        props.count === undefined
          ? props.label
          : `${props.label} ${String(props.count)}`
      }
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
      {props.count === undefined ? null : (
        <Text
          style={{
            color: palette.faint,
            fontSize: 11,
            fontVariant: ['tabular-nums'],
          }}
        >
          {props.count}
        </Text>
      )}
    </Pressable>
  );
}
