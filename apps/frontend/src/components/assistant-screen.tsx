import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import * as DocumentPicker from 'expo-document-picker';
import { AlertCircle, X } from 'lucide-react-native';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  VeraClient,
  type ConversationMessageResource,
  type ConversationResource,
  type ConversationSummaryResource,
  type MemoryResource,
  type NotificationResource,
  type PersonalTaskResource,
  type ProjectResource,
  type ReminderResource,
  type TaskResource,
  type AttachmentReference,
} from '@vera/client';

import { ApprovalCard } from '@/components/approval-card';
import { AssistantHeader } from '@/components/assistant/assistant-header';
import { ConversationSidebar } from '@/components/assistant/conversation-sidebar';
import { ConversationView } from '@/components/assistant/conversation-view';
import {
  MessageComposer,
  type ComposerAttachment,
} from '@/components/assistant/message-composer';
import { latestConversationProjectId } from '@/components/assistant/presentation';
import { useTaskDetails } from '@/components/assistant/use-task-details';
import { ResourcePanel, type ResourceTab } from '@/components/resource-panel';
import { layout, palette, radius, shadow, spacing } from '@/design/tokens';
import { useSpokenReply } from '@/voice/use-spoken-reply';
import { useVoiceInput } from '@/voice/use-voice-input';

const configuredApiUrl = process.env.EXPO_PUBLIC_VERA_API_URL?.trim();
const defaultApiUrl =
  process.env.EXPO_OS === 'android'
    ? 'http://10.0.2.2:4310'
    : 'http://127.0.0.1:4310';
const apiUrl =
  configuredApiUrl === undefined || configuredApiUrl.length === 0
    ? defaultApiUrl
    : configuredApiUrl;
const configuredSpeechLocale =
  process.env.EXPO_PUBLIC_VERA_SPEECH_LOCALE?.trim();
const speechLocale =
  configuredSpeechLocale === undefined || configuredSpeechLocale.length === 0
    ? 'en-US'
    : configuredSpeechLocale;
const EMPTY_MESSAGES: ConversationMessageResource[] = [];
const MAX_ATTACHMENTS = 5;
const DOCUMENT_ATTACHMENT_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
] as const;
const IMAGE_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tiff',
] as const;
const SUPPORTED_ATTACHMENT_TYPES = [
  ...DOCUMENT_ATTACHMENT_TYPES,
  ...IMAGE_ATTACHMENT_TYPES,
] as const;
type AttachmentUpload = ComposerAttachment & {
  bytes?: ArrayBuffer;
  previewUri?: string;
};

function requestKey(): string {
  return `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function attachmentMediaType(
  filename: string,
  declared?: string,
): AttachmentReference['mediaType'] | undefined {
  const normalized = declared?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    normalized !== undefined &&
    (SUPPORTED_ATTACHMENT_TYPES as readonly string[]).includes(normalized)
  ) {
    return normalized as AttachmentReference['mediaType'];
  }
  const extension = filename.toLowerCase().split('.').at(-1);
  return extension === 'pdf'
    ? 'application/pdf'
    : extension === 'md' || extension === 'markdown'
      ? 'text/markdown'
      : extension === 'json'
        ? 'application/json'
        : extension === 'txt' || extension === 'log'
          ? 'text/plain'
          : extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'png'
              ? 'image/png'
              : extension === 'webp'
                ? 'image/webp'
                : extension === 'gif'
                  ? 'image/gif'
                  : extension === 'heic'
                    ? 'image/heic'
                    : extension === 'heif'
                      ? 'image/heif'
                      : extension === 'avif'
                        ? 'image/avif'
                        : extension === 'tif' || extension === 'tiff'
                          ? 'image/tiff'
                          : undefined;
}

export function AssistantScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < layout.compactBreakpoint;
  const client = useMemo(
    () =>
      new VeraClient({
        baseUrl: apiUrl,
        fetch: (input, init) => expoFetch(input, init),
      }),
    [],
  );
  const [conversations, setConversations] = useState<
    ConversationSummaryResource[]
  >([]);
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
  const [resources, setResources] = useState<{
    open: boolean;
    tab: ResourceTab;
  }>({ open: false, tab: 'memory' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftFromVoice, setDraftFromVoice] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentUpload[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const messageList = useRef<FlatList<ConversationMessageResource>>(null);
  const followGeneration = useRef(0);
  const followAbort = useRef<AbortController | undefined>(undefined);
  const voiceRunIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const refreshInFlight = useRef(false);
  const attachmentPickerActive = useRef(false);
  const spokenReply = useSpokenReply({
    locale: speechLocale,
    onError: setError,
  });
  const voiceInput = useVoiceInput({
    transcribe: async ({ audio, contentType, signal }) => {
      const result = await client.transcribeAudio({
        audio,
        contentType,
        signal,
      });
      return result.text;
    },
    onFinish: (transcript, action) => {
      setDraft(transcript);
      setDraftFromVoice(transcript.trim().length > 0);
      if (action === 'submit') {
        if (transcript.trim().length === 0) {
          setError('No speech was recognized, so Vera did not send a message.');
        } else {
          void send(transcript, {
            fromVoice: true,
            allowDuringVoiceFinish: true,
          });
        }
      }
    },
    onError: setError,
  });
  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const taskDetails = useTaskDetails(client, messages);
  const unreadNotifications = notifications.filter(
    (notification) => notification.status === 'unread',
  ).length;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      followAbort.current?.abort();
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
    setConversations(conversationPage.conversations);
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

  const refreshAssistant = useCallback(async () => {
    if (refreshInFlight.current) return;
    const conversationId = conversation?.id;
    const runId = activeRun?.runId;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const [, refreshedConversation, refreshedRun] = await Promise.all([
        refreshResources(),
        conversationId === undefined
          ? Promise.resolve(undefined)
          : client.getConversation(conversationId),
        runId === undefined ? Promise.resolve(undefined) : client.getRun(runId),
      ]);
      if (!mounted.current) return;
      if (refreshedConversation !== undefined) {
        setConversation((current) =>
          current?.id === refreshedConversation.id
            ? refreshedConversation
            : current,
        );
      }
      if (refreshedRun !== undefined) {
        setActiveRun((current) =>
          current?.runId === refreshedRun.runId ? refreshedRun : current,
        );
      }
      setError(undefined);
    } catch (cause) {
      if (mounted.current)
        setError(errorMessage(cause, 'Vera could not refresh.'));
    } finally {
      refreshInFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [activeRun?.runId, client, conversation?.id, refreshResources]);

  useEffect(() => {
    let active = true;
    void refreshResources()
      .then(() => {
        if (active) setError(undefined);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, 'Unable to connect to Vera.'));
      });
    return () => {
      active = false;
    };
  }, [refreshResources]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshNotifications().catch(() => {
        // The durable inbox remains visible at its last successful snapshot.
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  useEffect(() => {
    if (messages.length > 0) {
      messageList.current?.scrollToEnd({ animated: true });
    }
  }, [activeRun?.runStatus, messages.length]);

  useEffect(() => {
    const conversationId = activeRun?.conversationId;
    const conversationReply = activeRun?.conversationReply;
    if (
      conversationId === undefined ||
      conversationReply?.status !== 'projected'
    ) {
      return;
    }
    let current = true;
    void client
      .getConversation(conversationId)
      .then((refreshed) => {
        if (current && mounted.current) {
          setConversation((selected) =>
            selected?.id === refreshed.id ? refreshed : selected,
          );
        }
      })
      .catch((cause: unknown) => {
        if (current && mounted.current) {
          setError(
            errorMessage(cause, 'Completed work could not be displayed.'),
          );
        }
      });
    return () => {
      current = false;
    };
  }, [
    activeRun?.conversationId,
    activeRun?.conversationReply?.projectedAt,
    activeRun?.conversationReply?.status,
    client,
  ]);

  async function selectConversation(id: string): Promise<void> {
    const generation = followGeneration.current + 1;
    followGeneration.current = generation;
    followAbort.current?.abort();
    voiceInput.abort();
    void spokenReply.stop();
    voiceRunIds.current.clear();
    try {
      const selected = await client.getConversation(id);
      if (followGeneration.current !== generation) return;
      setConversation(selected);
      setSelectedProjectId(latestConversationProjectId(selected.messages));
      setAttachments([]);
      setActiveRun(undefined);
      setSidebarOpen(false);
      setError(undefined);
    } catch (cause) {
      if (followGeneration.current === generation) {
        setError(errorMessage(cause, 'Conversation could not be loaded.'));
      }
    }
  }

  function startConversation(): void {
    followGeneration.current += 1;
    followAbort.current?.abort();
    voiceInput.abort();
    void spokenReply.stop();
    voiceRunIds.current.clear();
    setConversation(undefined);
    setActiveRun(undefined);
    setSelectedProjectId(undefined);
    setSidebarOpen(false);
    setDraft('');
    setDraftFromVoice(false);
    setAttachments([]);
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
    followAbort.current?.abort();
    const controller = new AbortController();
    followAbort.current = controller;
    try {
      const next = await client.waitForRun(run.runId, {
        signal: controller.signal,
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
        let refreshedConversation: ConversationResource | undefined;
        if (next.conversationId !== undefined) {
          refreshedConversation = await client.getConversation(
            next.conversationId,
          );
          setConversation(refreshedConversation);
        }
        if (voiceRunIds.current.delete(next.runId)) {
          const replyId = next.conversationReply?.messageId;
          const reply = refreshedConversation?.messages.find(
            (message) => message.id === replyId && message.role === 'vera',
          );
          if (reply !== undefined)
            void spokenReply.speak(reply.id, reply.content);
        }
        await refreshResources();
      }
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        followGeneration.current === generation
      ) {
        setError(errorMessage(cause, 'Run progress could not be loaded.'));
      }
    } finally {
      if (followAbort.current === controller) followAbort.current = undefined;
    }
  }

  async function send(
    content: string,
    options: { fromVoice?: boolean; allowDuringVoiceFinish?: boolean } = {},
  ): Promise<void> {
    const normalized = content.trim();
    if (
      normalized.length === 0 ||
      busy ||
      (!options.allowDuringVoiceFinish && voiceInput.phase !== 'idle')
    )
      return;
    const shouldSpeakReply = options.fromVoice ?? draftFromVoice;
    const readyAttachments = attachments.flatMap((attachment) =>
      attachment.status === 'ready' && attachment.resource !== undefined
        ? [attachment.resource]
        : [],
    );
    if (readyAttachments.length !== attachments.length) return;
    setBusy(true);
    setError(undefined);
    setDraft('');
    setDraftFromVoice(false);
    try {
      const current = await ensureConversation(normalized);
      const submitted = await client.appendMessage({
        conversationId: current.id,
        content: normalized,
        idempotencyKey: requestKey(),
        ...(selectedProjectId === undefined
          ? {}
          : { projectId: selectedProjectId }),
        ...(readyAttachments.length === 0
          ? {}
          : { attachmentIds: readyAttachments.map(({ id }) => id) }),
      });
      setAttachments([]);
      if (shouldSpeakReply) voiceRunIds.current.add(submitted.runId);
      setActiveRun(submitted);
      setConversation(await client.getConversation(current.id));
      void followRun(submitted);
    } catch (cause) {
      setDraft(normalized);
      setDraftFromVoice(shouldSpeakReply);
      setError(errorMessage(cause, 'Vera could not send the message.'));
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
      setError(errorMessage(cause, 'Approval decision failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (activeRun === undefined || busy) return;
    setBusy(true);
    try {
      const cancelled = await client.cancelRun(activeRun.runId);
      followAbort.current?.abort();
      followGeneration.current += 1;
      voiceRunIds.current.delete(activeRun.runId);
      setActiveRun(cancelled);
      if (cancelled.conversationId !== undefined) {
        setConversation(await client.getConversation(cancelled.conversationId));
      }
      await refreshResources();
    } catch (cause) {
      setError(errorMessage(cause, 'Cancellation failed.'));
    } finally {
      setBusy(false);
    }
  }

  function openResources(tab: ResourceTab): void {
    setSidebarOpen(false);
    setResources({ open: true, tab });
  }

  async function toggleVoiceInput(): Promise<void> {
    setError(undefined);
    if (voiceInput.phase === 'recording') {
      voiceInput.stop('review');
      return;
    }
    await spokenReply.stop();
    await voiceInput.start(draft);
  }

  async function uploadAttachment(upload: AttachmentUpload): Promise<void> {
    if (upload.bytes === undefined) return;
    setAttachments((current) =>
      current.map((item) =>
        item.localId === upload.localId
          ? { ...item, status: 'uploading', error: undefined }
          : item,
      ),
    );
    try {
      const resource = await client.uploadAttachment({
        filename: upload.filename,
        mediaType: upload.mediaType,
        bytes: upload.bytes,
      });
      if (!mounted.current) return;
      setAttachments((current) =>
        current.map((item) =>
          item.localId === upload.localId
            ? {
                ...item,
                status: 'ready',
                resource,
                bytes: undefined,
                error: undefined,
              }
            : item,
        ),
      );
    } catch (cause) {
      if (!mounted.current) return;
      setAttachments((current) =>
        current.map((item) =>
          item.localId === upload.localId
            ? {
                ...item,
                status: 'failed',
                error: errorMessage(cause, 'Upload failed.'),
              }
            : item,
        ),
      );
    }
  }

  async function addPickedAttachment(input: {
    uri: string;
    filename: string;
    declaredMediaType?: string;
  }): Promise<void> {
    const mediaType = attachmentMediaType(
      input.filename,
      input.declaredMediaType,
    );
    if (mediaType === undefined) {
      setError(`${input.filename} is not a supported attachment format.`);
      return;
    }
    const response = await expoFetch(input.uri);
    if (!response.ok) throw new Error(`Could not read ${input.filename}.`);
    const bytes = await response.arrayBuffer();
    const upload: AttachmentUpload = {
      localId: `attachment-local-${requestKey()}`,
      filename: input.filename,
      mediaType,
      byteLength: bytes.byteLength,
      status: 'uploading',
      bytes,
      ...(mediaType.startsWith('image/') ? { previewUri: input.uri } : {}),
    };
    setAttachments((current) => [...current, upload]);
    await uploadAttachment(upload);
  }

  async function pickAttachments(): Promise<void> {
    if (attachmentPickerActive.current) return;
    attachmentPickerActive.current = true;
    setAttaching(true);
    setError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...SUPPORTED_ATTACHMENT_TYPES],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const available = Math.max(0, MAX_ATTACHMENTS - attachments.length);
      const selected = result.assets.slice(0, available);
      if (result.assets.length > available) {
        setError('Vera accepts at most five attachments per message.');
      }
      for (const asset of selected) {
        await addPickedAttachment({
          uri: asset.uri,
          filename: asset.name,
          ...(asset.mimeType === undefined
            ? {}
            : { declaredMediaType: asset.mimeType }),
        });
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Vera could not open the selected file.'));
    } finally {
      attachmentPickerActive.current = false;
      if (mounted.current) setAttaching(false);
    }
  }

  function reuseAttachment(reference: AttachmentReference): void {
    setAttachments((current) => {
      if (
        current.length >= MAX_ATTACHMENTS ||
        current.some((attachment) => attachment.resource?.id === reference.id)
      ) {
        return current;
      }
      return [
        ...current,
        {
          localId: `attachment-reuse-${reference.id}`,
          filename: reference.filename,
          mediaType: reference.mediaType,
          byteLength: reference.byteLength,
          status: 'ready',
          resource: reference,
          ...(reference.kind === 'image'
            ? { previewUri: client.attachmentPreviewUrl(reference.id) }
            : {}),
        },
      ];
    });
  }

  const footer = (
    <RunFooter
      activeRun={activeRun}
      busy={busy}
      onCancel={() => void cancel()}
      onDecision={(decision) => void decide(decision)}
    />
  );

  return (
    <View
      style={{
        height: '100%',
        minHeight: compact ? undefined : 720,
        paddingTop: compact ? insets.top : 0,
        backgroundColor: palette.canvas,
      }}
    >
      <View style={{ minHeight: 0, flex: 1, flexDirection: 'row' }}>
        <ConversationSidebar
          compact={compact}
          conversationId={conversation?.id}
          conversations={conversations}
          memories={memories.length}
          notifications={unreadNotifications}
          open={!compact || sidebarOpen}
          tasks={tasks.length}
          onClose={() => setSidebarOpen(false)}
          onNew={startConversation}
          onOpenResources={openResources}
          onSelect={(id) => void selectConversation(id)}
        />

        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
          style={{ minWidth: 0, flex: 1, backgroundColor: palette.canvas }}
        >
          <AssistantHeader
            compact={compact}
            projects={projects}
            selectedProjectId={selectedProjectId}
            title={conversation?.title}
            unreadNotifications={unreadNotifications}
            refreshing={refreshing}
            onMenu={() => setSidebarOpen(true)}
            onRefresh={() => void refreshAssistant()}
            onResources={() => openResources('memory')}
            onSelectProject={setSelectedProjectId}
          />
          <View style={{ minHeight: 0, flex: 1 }}>
            <ConversationView
              ref={messageList}
              client={client}
              compact={compact}
              footer={footer}
              messages={messages}
              refreshing={refreshing}
              speakingMessageId={spokenReply.messageId}
              taskDetails={taskDetails}
              onSuggestion={(prompt) => {
                setDraft(prompt);
                setDraftFromVoice(false);
              }}
              onSpeak={(message) => {
                if (spokenReply.messageId === message.id)
                  void spokenReply.stop();
                else {
                  voiceInput.abort();
                  void spokenReply.speak(message.id, message.content);
                }
              }}
              onReuseAttachment={reuseAttachment}
              onRefresh={() => void refreshAssistant()}
            />
          </View>
          <MessageComposer
            bottomInset={compact ? insets.bottom : 0}
            busy={busy}
            compact={compact}
            draft={draft}
            draftFromVoice={draftFromVoice}
            voicePhase={voiceInput.phase}
            voiceDurationMs={voiceInput.durationMs}
            attachments={attachments}
            attaching={attaching}
            onAttach={() => void pickAttachments()}
            onRemoveAttachment={(localId) =>
              setAttachments((current) =>
                current.filter((attachment) => attachment.localId !== localId),
              )
            }
            onRetryAttachment={(localId) => {
              const upload = attachments.find(
                (attachment) => attachment.localId === localId,
              );
              if (upload !== undefined) void uploadAttachment(upload);
            }}
            onChange={(value) => {
              setDraft(value);
              if (value.trim().length === 0) setDraftFromVoice(false);
            }}
            onSend={() => void send(draft)}
            onVoice={() => void toggleVoiceInput()}
            onVoiceSend={() => voiceInput.stop('submit')}
          />
        </KeyboardAvoidingView>

        <ResourcePanel
          compact={compact}
          memories={memories}
          notifications={notifications}
          open={resources.open}
          reminders={reminders}
          tab={resources.tab}
          tasks={tasks}
          onClose={() =>
            setResources((current) => ({ ...current, open: false }))
          }
          onMemoryCommand={(command) => {
            setResources((current) => ({ ...current, open: false }));
            void send(command);
          }}
          onTab={(tab) => setResources({ open: true, tab })}
        />

        {error === undefined ? null : (
          <ErrorToast
            error={error}
            bottom={Math.max(insets.bottom, 18) + 82}
            onClose={() => setError(undefined)}
          />
        )}
      </View>
    </View>
  );
}

function RunFooter(props: {
  activeRun?: TaskResource;
  busy: boolean;
  onCancel: () => void;
  onDecision: (decision: 'approved' | 'rejected') => void;
}) {
  const run = props.activeRun;
  if (
    run?.runStatus === 'awaiting_approval' &&
    run.approval?.status === 'pending'
  ) {
    return (
      <ApprovalCard
        approval={run.approval}
        busy={props.busy}
        onDecision={props.onDecision}
      />
    );
  }
  if (
    run !== undefined &&
    ![
      'succeeded',
      'rejected',
      'failed',
      'cancelled',
      'awaiting_approval',
    ].includes(run.runStatus)
  ) {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          borderWidth: 1,
          borderColor: palette.lineSoft,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: palette.surface,
        }}
      >
        <ActivityIndicator color={palette.accent} size="small" />
        <Text
          selectable
          style={{
            minWidth: 0,
            flex: 1,
            color: palette.textSoft,
            fontSize: 13,
          }}
        >
          Vera is {run.runStatus.replaceAll('_', ' ')}…
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={props.busy}
          onPress={props.onCancel}
          style={({ pressed }) => ({
            minHeight: 40,
            justifyContent: 'center',
            borderRadius: radius.sm,
            paddingHorizontal: spacing.md,
            opacity: props.busy ? 0.4 : pressed ? 0.65 : 1,
          })}
        >
          <Text
            style={{ color: palette.danger, fontSize: 12, fontWeight: '600' }}
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

function ErrorToast(props: {
  error: string;
  bottom: number;
  onClose: () => void;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        right: spacing.lg,
        bottom: props.bottom,
        left: spacing.lg,
        maxWidth: 520,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        borderWidth: 1,
        borderColor: '#714047',
        borderRadius: radius.md,
        padding: spacing.md,
        backgroundColor: palette.dangerSurface,
        boxShadow: shadow.floating,
      }}
    >
      <AlertCircle color={palette.danger} size={19} strokeWidth={1.9} />
      <Text
        selectable
        style={{
          minWidth: 0,
          flex: 1,
          color: '#FFD6D6',
          fontSize: 13,
          lineHeight: 19,
        }}
      >
        {props.error}
      </Text>
      <Pressable
        accessibilityLabel="Dismiss error"
        accessibilityRole="button"
        hitSlop={8}
        onPress={props.onClose}
      >
        <X color={palette.danger} size={18} />
      </Pressable>
    </View>
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
