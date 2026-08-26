import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  VeraClient,
  type ConversationResource,
  type MemoryResource,
  type NotificationResource,
  type PersonalTaskResource,
  type ProjectResource,
  type ReminderResource,
  type TaskResource,
} from '@vera/client';

import { ApprovalCard } from '@/components/approval-card';
import { ResourcePanel, type ResourceTab } from '@/components/resource-panel';

type ConversationSummary = {
  id: string;
  title?: string;
  messageCount?: number;
};

const configuredApiUrl = process.env.EXPO_PUBLIC_VERA_API_URL?.trim();
const defaultApiUrl =
  process.env.EXPO_OS === 'android'
    ? 'http://10.0.2.2:4310'
    : 'http://127.0.0.1:4310';
const apiUrl =
  configuredApiUrl === undefined || configuredApiUrl.length === 0
    ? defaultApiUrl
    : configuredApiUrl;

function requestKey(): string {
  return `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function AssistantScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 880;
  const client = useMemo(
    () =>
      new VeraClient({
        baseUrl: apiUrl,
        fetch: (input, init) => expoFetch(input, init),
      }),
    [],
  );
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversation, setConversation] = useState<ConversationResource>();
  const [projects, setProjects] = useState<ProjectResource[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [activeRun, setActiveRun] = useState<TaskResource>();
  const [memories, setMemories] = useState<MemoryResource[]>([]);
  const [tasks, setTasks] = useState<PersonalTaskResource[]>([]);
  const [reminders, setReminders] = useState<ReminderResource[]>([]);
  const [notifications, setNotifications] = useState<NotificationResource[]>(
    [],
  );
  const [drawer, setDrawer] = useState<{ open: boolean; tab: ResourceTab }>({
    open: false,
    tab: 'memory',
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const messageScroll = useRef<ScrollView>(null);
  const followGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshResources = useCallback(async () => {
    const [
      conversationPage,
      projectPage,
      memoryPage,
      taskPage,
      reminderPage,
      inbox,
    ] = await Promise.all([
      client.listConversations(),
      client.listProjects(),
      client.listMemories(),
      client.listPersonalTasks(),
      client.listReminders(),
      client.listNotifications({ limit: 50 }),
    ]);
    if (!mounted.current) return;
    setConversations(conversationPage.conversations as ConversationSummary[]);
    setProjects(projectPage.projects);
    setMemories(memoryPage.memories);
    setTasks(taskPage.tasks);
    setReminders(reminderPage.reminders);
    setNotifications([...inbox.notifications].reverse());
  }, [client]);

  const refreshNotifications = useCallback(async () => {
    const inbox = await client.listNotifications({ limit: 50 });
    if (mounted.current) {
      setNotifications([...inbox.notifications].reverse());
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await refreshResources();
        if (active) setError(undefined);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to connect to Vera.',
          );
        }
      }
    };
    void refresh();
    return () => {
      active = false;
    };
  }, [refreshResources]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshNotifications().catch(() => {
        // The durable inbox remains visible at its last successful snapshot.
        // Foreground commands and full refreshes surface connection failures.
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  useEffect(() => {
    messageScroll.current?.scrollToEnd({ animated: true });
  }, [conversation?.messages.length, activeRun?.runStatus]);

  async function selectConversation(id: string): Promise<void> {
    const generation = followGeneration.current + 1;
    followGeneration.current = generation;
    try {
      const selected = await client.getConversation(id);
      if (followGeneration.current !== generation) return;
      setConversation(selected);
      setActiveRun(undefined);
      setSidebarOpen(false);
      setError(undefined);
    } catch (cause) {
      if (followGeneration.current === generation) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Conversation could not be loaded.',
        );
      }
    }
  }

  function startConversation(): void {
    followGeneration.current += 1;
    setConversation(undefined);
    setActiveRun(undefined);
    setSelectedProjectId(undefined);
    setSidebarOpen(false);
    setError(undefined);
  }

  async function ensureConversation(
    title: string,
  ): Promise<ConversationResource> {
    if (conversation !== undefined) return conversation;
    const created = await client.createConversation({
      title: title.slice(0, 200),
      idempotencyKey: requestKey(),
    });
    setConversation(created);
    return created;
  }

  async function followRun(run: TaskResource): Promise<void> {
    const generation = followGeneration.current + 1;
    followGeneration.current = generation;
    try {
      const next = await client.waitForRun(run.runId, {
        until: (task) =>
          task.runStatus === 'awaiting_approval' ||
          (['succeeded', 'rejected', 'failed', 'cancelled'].includes(
            task.runStatus,
          ) &&
            (task.conversationId === undefined ||
              task.conversationReply?.status === 'projected')),
        onUpdate: (update) => {
          if (followGeneration.current === generation) setActiveRun(update);
        },
      });
      if (followGeneration.current !== generation) return;
      setActiveRun(next);
      if (next.runStatus !== 'awaiting_approval') {
        if (next.conversationId !== undefined) {
          setConversation(await client.getConversation(next.conversationId));
        }
        await refreshResources();
      }
    } catch (cause) {
      if (followGeneration.current === generation) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Run progress could not be loaded.',
        );
      }
    }
  }

  async function send(content: string): Promise<void> {
    const normalized = content.trim();
    if (normalized.length === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    setDraft('');
    try {
      const current = await ensureConversation(normalized);
      const submitted = await client.appendMessage({
        conversationId: current.id,
        content: normalized,
        idempotencyKey: requestKey(),
        ...(selectedProjectId === undefined
          ? {}
          : { projectId: selectedProjectId }),
      });
      setActiveRun(submitted);
      setConversation(await client.getConversation(current.id));
      void followRun(submitted);
    } catch (cause) {
      setDraft(normalized);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Vera could not send the message.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: 'approved' | 'rejected'): Promise<void> {
    if (activeRun?.approval === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const decided = await client.decideApproval(
        activeRun.approval.id,
        decision,
      );
      setActiveRun(decided);
      void followRun(decided);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Approval decision failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (activeRun === undefined || busy) return;
    setBusy(true);
    try {
      const cancelled = await client.cancelRun(activeRun.runId);
      followGeneration.current += 1;
      setActiveRun(cancelled);
      if (cancelled.conversationId !== undefined) {
        setConversation(await client.getConversation(cancelled.conversationId));
      }
      await refreshResources();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cancellation failed.');
    } finally {
      setBusy(false);
    }
  }

  function openDrawer(tab: ResourceTab): void {
    setSidebarOpen(false);
    setDrawer({ open: true, tab });
  }

  return (
    <ScrollView
      contentContainerStyle={{ minHeight: '100%', backgroundColor: '#0b0e12' }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      scrollEnabled={!compact || !sidebarOpen}
    >
      <View
        style={{
          minHeight: 720,
          flexDirection: compact ? 'column' : 'row',
          paddingTop: compact ? insets.top : 0,
          backgroundColor: '#0b0e12',
        }}
      >
        {compact ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottomWidth: 1,
              borderBottomColor: '#20252c',
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Pressable
              accessibilityLabel="Toggle conversations"
              accessibilityRole="button"
              onPress={() => setSidebarOpen((value) => !value)}
            >
              <Text style={{ color: '#d9dfdc', fontSize: 22 }}>☰</Text>
            </Pressable>
            <Text
              selectable
              style={{ color: '#f0f4f2', fontSize: 18, fontWeight: '700' }}
            >
              Vera
            </Text>
            <Pressable
              accessibilityLabel="Open memory"
              accessibilityRole="button"
              onPress={() => openDrawer('memory')}
            >
              <Text style={{ color: '#69d8ae', fontSize: 20 }}>◫</Text>
            </Pressable>
          </View>
        ) : null}

        {!compact ? (
          <Sidebar
            compact={false}
            conversationId={conversation?.id}
            conversations={conversations}
            memories={memories.length}
            notifications={
              notifications.filter((item) => item.status === 'unread').length
            }
            tasks={tasks.length}
            onNew={startConversation}
            onOpenDrawer={openDrawer}
            onSelect={(id) => void selectConversation(id)}
          />
        ) : null}

        <View style={{ minWidth: 0, flex: 1 }}>
          <View
            style={{
              flexDirection: compact ? 'column' : 'row',
              alignItems: compact ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#20252c',
              paddingHorizontal: compact ? 16 : 34,
              paddingVertical: 18,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text selectable style={{ color: '#63d1a6', fontSize: 10 }}>
                CONVERSATION
              </Text>
              <Text
                numberOfLines={1}
                selectable
                style={{ color: '#f0f3f2', fontSize: 18, fontWeight: '700' }}
              >
                {conversation?.title ?? 'New conversation'}
              </Text>
            </View>
            <ProjectSelector
              projects={projects}
              selected={selectedProjectId}
              onSelect={setSelectedProjectId}
            />
          </View>

          <ScrollView
            ref={messageScroll}
            contentContainerStyle={{
              width: '100%',
              maxWidth: 900,
              minHeight: compact ? 440 : 550,
              alignSelf: 'center',
              gap: 18,
              padding: compact ? 18 : 36,
            }}
            contentInsetAdjustmentBehavior="automatic"
          >
            {(conversation?.messages ?? []).length === 0 ? (
              <View
                style={{ alignItems: 'center', gap: 12, paddingVertical: 90 }}
              >
                <View
                  style={{
                    width: 54,
                    height: 54,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#356352',
                    borderRadius: 18,
                    backgroundColor: '#102019',
                  }}
                >
                  <Text selectable style={{ color: '#67d7aa', fontSize: 25 }}>
                    V
                  </Text>
                </View>
                <Text selectable style={{ color: '#65d6aa', fontSize: 10 }}>
                  READY WHEN YOU ARE
                </Text>
                <Text
                  selectable
                  style={{
                    color: '#f3f5f4',
                    fontSize: 28,
                    textAlign: 'center',
                  }}
                >
                  What should we get done?
                </Text>
                <Text
                  selectable
                  style={{
                    maxWidth: 500,
                    color: '#87928d',
                    lineHeight: 22,
                    textAlign: 'center',
                  }}
                >
                  Ask Vera to remember a preference, research the web, manage a
                  reminder, or work on one of your projects.
                </Text>
              </View>
            ) : null}

            {conversation?.messages.map((message) => (
              <View
                key={message.id}
                style={{
                  maxWidth: 760,
                  alignSelf:
                    message.role === 'owner' ? 'flex-end' : 'flex-start',
                  gap: 6,
                  borderWidth: message.role === 'owner' ? 1 : 0,
                  borderColor: '#29322e',
                  borderRadius: 16,
                  padding: message.role === 'owner' ? 14 : 4,
                  backgroundColor:
                    message.role === 'owner' ? '#151b19' : 'transparent',
                }}
              >
                <Text
                  selectable
                  style={{ color: '#68d6aa', fontSize: 10, fontWeight: '700' }}
                >
                  {message.role === 'vera' ? 'VERA' : 'YOU'}
                </Text>
                <Text
                  selectable
                  style={{ color: '#dce2df', fontSize: 16, lineHeight: 25 }}
                >
                  {message.content}
                </Text>
              </View>
            ))}

            {activeRun?.runStatus === 'awaiting_approval' &&
            activeRun.approval?.status === 'pending' ? (
              <ApprovalCard
                approval={activeRun.approval}
                busy={busy}
                onDecision={(decision) => void decide(decision)}
              />
            ) : null}

            {activeRun !== undefined &&
            ![
              'succeeded',
              'rejected',
              'failed',
              'cancelled',
              'awaiting_approval',
            ].includes(activeRun.runStatus) ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <ActivityIndicator color="#62d0a4" size="small" />
                <Text selectable style={{ color: '#9da7a2' }}>
                  Vera is {activeRun.runStatus.replaceAll('_', ' ')}…
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void cancel()}
                >
                  <Text style={{ color: '#d88484' }}>Cancel</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={{
              width: '100%',
              maxWidth: 900,
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 10,
              paddingHorizontal: compact ? 16 : 32,
              paddingBottom: Math.max(insets.bottom, 18),
            }}
          >
            <TextInput
              accessibilityLabel="Message Vera"
              multiline
              onChangeText={setDraft}
              onSubmitEditing={() => void send(draft)}
              placeholder="Message Vera…"
              placeholderTextColor="#69736f"
              style={{
                minHeight: 58,
                maxHeight: 150,
                flex: 1,
                borderWidth: 1,
                borderColor: '#303a35',
                borderRadius: 17,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: '#edf1ef',
                fontSize: 16,
                textAlignVertical: 'top',
                backgroundColor: '#12171c',
              }}
              value={draft}
            />
            <Pressable
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void send(draft)}
              style={({ pressed }) => ({
                width: 54,
                height: 54,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 17,
                opacity:
                  busy || draft.trim().length === 0 ? 0.35 : pressed ? 0.7 : 1,
                backgroundColor: '#225b45',
              })}
            >
              <Text style={{ color: '#e8fff6', fontSize: 22 }}>↑</Text>
            </Pressable>
          </View>
        </View>

        <ResourcePanel
          compact={compact}
          memories={memories}
          notifications={notifications}
          onClose={() => setDrawer((current) => ({ ...current, open: false }))}
          onMemoryCommand={(command) => {
            setDrawer((current) => ({ ...current, open: false }));
            void send(command);
          }}
          onTab={(tab) => setDrawer({ open: true, tab })}
          open={drawer.open}
          reminders={reminders}
          tab={drawer.tab}
          tasks={tasks}
        />

        {compact && sidebarOpen ? (
          <View
            accessibilityViewIsModal
            style={{
              position: 'absolute',
              zIndex: 20,
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              minHeight: 720,
              flexDirection: 'row',
            }}
          >
            <Sidebar
              compact
              conversationId={conversation?.id}
              conversations={conversations}
              memories={memories.length}
              notifications={
                notifications.filter((item) => item.status === 'unread').length
              }
              tasks={tasks.length}
              width={Math.min(width - 48, 360)}
              onClose={() => setSidebarOpen(false)}
              onNew={startConversation}
              onOpenDrawer={openDrawer}
              onSelect={(id) => void selectConversation(id)}
            />
            <Pressable
              accessibilityLabel="Close conversations"
              accessibilityRole="button"
              onPress={() => setSidebarOpen(false)}
              style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.62)' }}
            />
          </View>
        ) : null}

        {error === undefined ? null : (
          <View
            accessibilityRole="alert"
            style={{
              position: 'absolute',
              right: 18,
              bottom: 18,
              maxWidth: 420,
              borderWidth: 1,
              borderColor: '#794848',
              borderRadius: 12,
              padding: 14,
              backgroundColor: '#2c191b',
            }}
          >
            <Text selectable style={{ color: '#ffd2d2' }}>
              {error}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Sidebar(props: {
  compact: boolean;
  width?: number;
  conversationId?: string;
  conversations: ConversationSummary[];
  memories: number;
  tasks: number;
  notifications: number;
  onNew: () => void;
  onClose?: () => void;
  onSelect: (id: string) => void;
  onOpenDrawer: (tab: ResourceTab) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        width: props.compact ? props.width : 280,
        minHeight: 720,
        borderRightWidth: 1,
        borderColor: '#20252c',
        padding: 16,
        paddingTop: props.compact ? Math.max(insets.top, 16) : 16,
        backgroundColor: '#0d1015',
        boxShadow: props.compact ? '8px 0 28px rgba(0, 0, 0, 0.36)' : undefined,
      }}
    >
      {props.compact ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 6,
            paddingBottom: 18,
          }}
        >
          <View style={{ gap: 3 }}>
            <Text
              selectable
              style={{ color: '#f0f4f2', fontSize: 18, fontWeight: '800' }}
            >
              Conversations
            </Text>
            <Text selectable style={{ color: '#737d79', fontSize: 11 }}>
              Personal intelligence
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close conversations"
            accessibilityRole="button"
            onPress={props.onClose}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              opacity: pressed ? 0.65 : 1,
              backgroundColor: '#171d22',
            })}
          >
            <Text style={{ color: '#cbd2cf', fontSize: 22 }}>×</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 3, padding: 6, paddingBottom: 18 }}>
          <Text
            selectable
            style={{ color: '#f0f4f2', fontSize: 20, fontWeight: '800' }}
          >
            Vera
          </Text>
          <Text selectable style={{ color: '#737d79', fontSize: 11 }}>
            Personal intelligence
          </Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={props.onNew}
        style={{
          borderWidth: 1,
          borderColor: '#29312e',
          borderRadius: 13,
          padding: 13,
          backgroundColor: '#151a20',
        }}
      >
        <Text style={{ color: '#dce2df' }}>＋ New conversation</Text>
      </Pressable>
      <Text
        selectable
        style={{
          paddingTop: 20,
          paddingBottom: 8,
          color: '#66706c',
          fontSize: 10,
        }}
      >
        RECENT
      </Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 5 }}>
        {props.conversations.map((item) => (
          <Pressable
            accessibilityRole="button"
            key={item.id}
            onPress={() => props.onSelect(item.id)}
            style={{
              gap: 3,
              borderRadius: 10,
              padding: 10,
              backgroundColor:
                props.conversationId === item.id ? '#19211e' : 'transparent',
            }}
          >
            <Text numberOfLines={1} style={{ color: '#d3d9d6', fontSize: 12 }}>
              {item.title ?? 'Untitled conversation'}
            </Text>
            <Text
              style={{
                color: '#68726e',
                fontSize: 10,
                fontVariant: ['tabular-nums'],
              }}
            >
              {item.messageCount ?? 0} messages
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View
        style={{
          gap: 5,
          borderTopWidth: 1,
          borderTopColor: '#20252c',
          paddingTop: 12,
        }}
      >
        <ResourceButton
          label="Memory"
          count={props.memories}
          onPress={() => props.onOpenDrawer('memory')}
        />
        <ResourceButton
          label="Tasks"
          count={props.tasks}
          onPress={() => props.onOpenDrawer('tasks')}
        />
        <ResourceButton
          label="Inbox"
          count={props.notifications}
          onPress={() => props.onOpenDrawer('notifications')}
        />
      </View>
    </View>
  );
}

function ResourceButton(props: {
  label: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${props.label} ${String(props.count)}`}
      accessibilityRole="button"
      onPress={props.onPress}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 10,
      }}
    >
      <Text style={{ color: '#aab3af' }}>{props.label}</Text>
      <Text style={{ color: '#6f7a75', fontVariant: ['tabular-nums'] }}>
        {props.count}
      </Text>
    </Pressable>
  );
}

function ProjectSelector(props: {
  projects: ProjectResource[];
  selected?: string;
  onSelect: (projectId?: string) => void;
}) {
  if (props.projects.length === 0) {
    return (
      <Text selectable style={{ color: '#737e79', fontSize: 11 }}>
        No project context
      </Text>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={{ flexDirection: 'row', gap: 7 }}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      <ProjectButton
        label="No project"
        selected={props.selected === undefined}
        onPress={() => props.onSelect(undefined)}
      />
      {props.projects.map((project) => (
        <ProjectButton
          key={project.id}
          label={project.displayName}
          selected={props.selected === project.id}
          onPress={() => props.onSelect(project.id)}
        />
      ))}
    </ScrollView>
  );
}

function ProjectButton(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={{
        borderWidth: 1,
        borderColor: props.selected ? '#4e8b72' : '#29322e',
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 7,
        backgroundColor: props.selected ? '#173126' : '#12171c',
      }}
    >
      <Text
        style={{ color: props.selected ? '#dff8ee' : '#84908a', fontSize: 11 }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
