import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
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
  type MachineCatalogResource,
  type NotificationResource,
  type PersonalTaskResource,
  type ProjectResource,
  type ReminderResource,
  type TaskResource,
  type DevelopmentCampaignResource,
  type DevelopmentCampaignPolicyResource,
  type MissionResource,
  type KnowledgeSearchResponse,
  type KnowledgeSourceResource,
  type AttentionBriefing,
  type RoutineResource,
  type RoutineRunResource,
} from '@vera/client';
import { AssistantHeader } from '@/components/assistant/assistant-header';
import { ConversationSidebar } from '@/components/assistant/conversation-sidebar';
import { ConversationView } from '@/components/assistant/conversation-view';
import { MessageComposer } from '@/components/assistant/message-composer';
import { latestConversationProjectId } from '@/components/assistant/presentation';
import { useTaskDetails } from '@/components/assistant/use-task-details';
import { useAttachments } from '@/components/assistant/use-attachments';
import {
  ErrorToast,
  RunFooter,
  errorMessage,
} from '@/components/assistant/run-status';
import { ResourcePanel, type ResourceTab } from '@/components/resource-panel';
import { layout, palette } from '@/design/tokens';
import { useSpokenReply } from '@/voice/use-spoken-reply';
import { useVoiceInput } from '@/voice/use-voice-input';
import { usePushNotifications } from '@/notifications/use-push-notifications';
import { useIntegrationConnections } from '@/components/integrations/use-integration-connections';
import { useCreateExternalWatch } from '@/components/routines/use-create-external-watch';
import {
  createAttentionActions,
  newestAttention,
} from '@/components/assistant/attention-actions';

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

function requestKey(): string {
  return `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  const [knowledgeSources, setKnowledgeSources] = useState<
    KnowledgeSourceResource[]
  >([]);
  const [tasks, setTasks] = useState<PersonalTaskResource[]>([]);
  const [reminders, setReminders] = useState<ReminderResource[]>([]);
  const [notifications, setNotifications] = useState<NotificationResource[]>(
    [],
  );
  const [machines, setMachines] = useState<MachineCatalogResource['machines']>(
    [],
  );
  const [campaigns, setCampaigns] = useState<DevelopmentCampaignResource[]>([]);
  const [campaignPolicies, setCampaignPolicies] = useState<
    DevelopmentCampaignPolicyResource[]
  >([]);
  const [missions, setMissions] = useState<MissionResource[]>([]);
  const [routines, setRoutines] = useState<RoutineResource[]>([]);
  const [routineRuns, setRoutineRuns] = useState<
    Partial<Record<string, RoutineRunResource[]>>
  >({});
  const [routineActionId, setRoutineActionId] = useState<string>();
  const [attention, setAttention] = useState<AttentionBriefing>();
  const [focusedAttentionItemId, setFocusedAttentionItemId] =
    useState<string>();
  const [resources, setResources] = useState<{
    open: boolean;
    tab: ResourceTab;
  }>({ open: false, tab: 'attention' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftFromVoice, setDraftFromVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const messageList = useRef<FlatList<ConversationMessageResource>>(null);
  const followGeneration = useRef(0);
  const followAbort = useRef<AbortController | undefined>(undefined);
  const voiceRunIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const refreshInFlight = useRef(false);
  const integrationConnections = useIntegrationConnections({
    client,
    mounted,
    onError: setError,
  });
  const {
    attachments,
    attaching,
    clearAttachments,
    pickAttachments,
    removeAttachment,
    retryAttachment,
    reuseAttachment,
  } = useAttachments({ client, mounted, onError: setError });
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
      knowledgePage,
      taskPage,
      reminderPage,
      inbox,
      machineCatalog,
      campaignPolicyPage,
      campaignPage,
      missionPage,
      attentionBriefing,
      routinePage,
    ] = await Promise.all([
      client.listConversations(),
      client.listProjects(),
      client.listMemories(),
      client.listKnowledgeSources(),
      client.listPersonalTasks(),
      client.listReminders(),
      client.listNotifications({ limit: 50 }),
      client.listMachines(),
      client.listDevelopmentCampaignPolicies(),
      client.listDevelopmentCampaigns(),
      client.listMissions(),
      client.getAttentionBriefing(),
      client.listRoutines(),
      integrationConnections.refresh(),
    ]);
    if (!mounted.current) return;
    setConversations(conversationPage.conversations);
    setProjects(projectPage.projects);
    setMemories(memoryPage.memories);
    setKnowledgeSources(knowledgePage.sources);
    setTasks(taskPage.tasks);
    setReminders(reminderPage.reminders);
    setNotifications([...inbox.notifications].reverse());
    setMachines(machineCatalog.machines);
    setCampaignPolicies(campaignPolicyPage.policies);
    setCampaigns(campaignPage.campaigns);
    setMissions(missionPage.missions);
    setAttention((current) => newestAttention(current, attentionBriefing));
    setRoutines(routinePage.routines);
    const runEntries = await Promise.all(
      routinePage.routines.map(async (routine) => {
        try {
          const page = await client.listRoutineRuns(routine.id);
          return [routine.id, page.runs] as const;
        } catch {
          return [routine.id, [] as RoutineRunResource[]] as const;
        }
      }),
    );
    setRoutineRuns(Object.fromEntries(runEntries));
  }, [client, integrationConnections.refresh]);

  const searchKnowledge = useCallback(
    (query: string): Promise<KnowledgeSearchResponse> =>
      client.searchKnowledge({ query, limit: 8 }),
    [client],
  );

  const removeKnowledge = useCallback(
    async (sourceId: string): Promise<boolean> => {
      try {
        await client.removeKnowledgeSource(sourceId);
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not remove that source.'));
        }
        return false;
      }
    },
    [client, refreshResources],
  );

  const refreshNotifications = useCallback(async () => {
    const [inbox, campaignPage, missionPage, attentionBriefing, routinePage] =
      await Promise.all([
        client.listNotifications({ limit: 50 }),
        client.listDevelopmentCampaigns(),
        client.listMissions(),
        client.getAttentionBriefing(),
        client.listRoutines(),
      ]);
    if (mounted.current) {
      setNotifications([...inbox.notifications].reverse());
      setCampaigns(campaignPage.campaigns);
      setMissions(missionPage.missions);
      setAttention((current) => newestAttention(current, attentionBriefing));
      setRoutines(routinePage.routines);
    }
    const runEntries = await Promise.all(
      routinePage.routines.map(async (routine) => {
        try {
          const page = await client.listRoutineRuns(routine.id);
          return [routine.id, page.runs] as const;
        } catch {
          return [routine.id, [] as RoutineRunResource[]] as const;
        }
      }),
    );
    if (mounted.current) setRoutineRuns(Object.fromEntries(runEntries));
  }, [client]);

  const openPushAttention = useCallback((attentionItemId?: string) => {
    setFocusedAttentionItemId(attentionItemId);
    setResources({ open: true, tab: 'attention' });
  }, []);
  const pushNotifications = usePushNotifications({
    client,
    onAttention: openPushAttention,
    onRefresh: refreshNotifications,
    onError: setError,
  });

  const createCampaign = useCallback(
    async (input: {
      projectId: string;
      policyId: string;
      objective: string;
    }) => {
      const idempotencyKey = requestKey();
      const subject = input.objective.trim().replace(/\s+/gu, ' ');
      const title = `feat: ${subject}`.slice(0, 256);
      try {
        const campaign = await client.createDevelopmentCampaign({
          ...input,
          idempotencyKey,
          ticket: {
            reference: `CAMPAIGN-${idempotencyKey.slice(-12).toUpperCase()}`,
            details: input.objective,
          },
          delivery: {
            commitMessage: title,
            pullRequest: {
              title,
              body: [
                '## Summary',
                '',
                input.objective,
                '',
                '## Delivery',
                '',
                `Governed by Vera development campaign policy \`${input.policyId}\`.`,
              ].join('\n'),
              draft: false,
            },
          },
        });
        if (mounted.current) {
          setCampaigns((current) => [
            campaign,
            ...current.filter((candidate) => candidate.id !== campaign.id),
          ]);
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not prepare the campaign.'));
        }
        return false;
      }
    },
    [client],
  );

  const decideCampaign = useCallback(
    async (campaignId: string, decision: 'approved' | 'rejected') => {
      try {
        const campaign = await client.decideDevelopmentCampaign({
          campaignId,
          decision,
        });
        if (mounted.current) {
          setCampaigns((current) =>
            current.map((candidate) =>
              candidate.id === campaign.id ? campaign : candidate,
            ),
          );
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not record that decision.'));
        }
        return false;
      }
    },
    [client],
  );

  const cancelCampaign = useCallback(
    async (campaignId: string) => {
      try {
        const campaign = await client.cancelDevelopmentCampaign(campaignId);
        if (mounted.current) {
          setCampaigns((current) =>
            current.map((candidate) =>
              candidate.id === campaign.id ? campaign : candidate,
            ),
          );
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not cancel the campaign.'));
        }
        return false;
      }
    },
    [client],
  );

  const requestCampaignRepair = useCallback(
    async (campaignId: string) => {
      try {
        const campaign = await client.requestDevelopmentCampaignRepair({
          campaignId,
          idempotencyKey: requestKey(),
        });
        if (mounted.current) {
          setCampaigns((current) =>
            current.map((candidate) =>
              candidate.id === campaign.id ? campaign : candidate,
            ),
          );
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not prepare that repair.'));
        }
        return false;
      }
    },
    [client],
  );

  const decideCampaignRepair = useCallback(
    async (
      campaignId: string,
      repairId: string,
      decision: 'approved' | 'rejected',
    ) => {
      try {
        const campaign = await client.decideDevelopmentCampaignRepair({
          campaignId,
          repairId,
          decision,
        });
        if (mounted.current) {
          setCampaigns((current) =>
            current.map((candidate) =>
              candidate.id === campaign.id ? campaign : candidate,
            ),
          );
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(
            errorMessage(cause, 'Vera could not record that repair decision.'),
          );
        }
        return false;
      }
    },
    [client],
  );

  const decideMission = useCallback(
    async (missionId: string, decision: 'approved' | 'rejected') => {
      try {
        const mission = await client.decideMission({ missionId, decision });
        if (mounted.current) {
          setMissions((current) =>
            current.map((candidate) =>
              candidate.id === mission.id ? mission : candidate,
            ),
          );
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not record that decision.'));
        }
        return false;
      }
    },
    [client],
  );

  const cancelMission = useCallback(
    async (missionId: string) => {
      try {
        const mission = await client.cancelMission(missionId);
        if (mounted.current) {
          setMissions((current) =>
            current.map((candidate) =>
              candidate.id === mission.id ? mission : candidate,
            ),
          );
          setError(undefined);
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, 'Vera could not cancel the mission.'));
        }
        return false;
      }
    },
    [client],
  );

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
      clearAttachments();
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
    clearAttachments();
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
      clearAttachments();
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

  const { decideAttention, handleAttention, openAttentionItem } =
    createAttentionActions({
      client,
      isMounted: () => mounted.current,
      onBriefing: (updated) =>
        setAttention((current) => newestAttention(current, updated)),
      onCloseResources: () =>
        setResources((current) => ({ ...current, open: false })),
      onOpenResources: openResources,
      onSelectConversation: selectConversation,
      onRun: setActiveRun,
      onFollowRun: (task) => void followRun(task),
      onError: setError,
    });

  async function openNotificationItem(
    notification: NotificationResource,
  ): Promise<void> {
    const url =
      'externalSignalId' in notification
        ? notification.url
        : 'missionId' in notification
          ? notification.pullRequestUrl
          : undefined;
    if (url === undefined) return;
    try {
      await Linking.openURL(url);
    } catch (cause) {
      setError(errorMessage(cause, 'That activity link could not be opened.'));
    }
  }

  const createRoutine = useCallback(
    async (input: {
      title: string;
      machineId: string;
      serviceIds?: string[];
      localTime: string;
      daysOfWeek: number[];
      timeZone: string;
    }): Promise<boolean> => {
      setRoutineActionId('create');
      try {
        await client.createRoutine({
          title: input.title,
          schedule: {
            kind: 'daily',
            timeZone: input.timeZone,
            localTime: input.localTime,
            daysOfWeek: input.daysOfWeek,
          },
          action: {
            kind: 'machine_health_check',
            machineId: input.machineId,
            ...(input.serviceIds === undefined
              ? {}
              : { serviceIds: input.serviceIds }),
          },
          idempotencyKey: requestKey(),
        });
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(errorMessage(cause, 'Vera could not create that routine.'));
        return false;
      } finally {
        if (mounted.current) setRoutineActionId(undefined);
      }
    },
    [client, refreshResources],
  );

  const createExternalWatch = useCreateExternalWatch({
    client,
    refreshResources,
    mounted,
    requestKey,
    setActionId: setRoutineActionId,
    setError,
  });

  const routineDecision = useCallback(
    async (
      routineId: string,
      decision: 'approved' | 'rejected',
    ): Promise<boolean> => {
      setRoutineActionId(routineId);
      try {
        await client.decideRoutine({ routineId, decision });
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(errorMessage(cause, 'Vera could not decide that routine.'));
        return false;
      } finally {
        if (mounted.current) setRoutineActionId(undefined);
      }
    },
    [client, refreshResources],
  );

  const pauseRoutine = useCallback(
    async (routineId: string): Promise<boolean> => {
      setRoutineActionId(routineId);
      try {
        await client.pauseRoutine(routineId);
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(errorMessage(cause, 'Vera could not pause that routine.'));
        return false;
      } finally {
        if (mounted.current) setRoutineActionId(undefined);
      }
    },
    [client, refreshResources],
  );

  const resumeRoutine = useCallback(
    async (routineId: string): Promise<boolean> => {
      setRoutineActionId(routineId);
      try {
        await client.resumeRoutine(routineId);
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(errorMessage(cause, 'Vera could not resume that routine.'));
        return false;
      } finally {
        if (mounted.current) setRoutineActionId(undefined);
      }
    },
    [client, refreshResources],
  );

  const runRoutineNow = useCallback(
    async (routineId: string): Promise<RoutineRunResource | undefined> => {
      setRoutineActionId(routineId);
      try {
        const run = await client.runRoutineNow({
          routineId,
          idempotencyKey: requestKey(),
        });
        if (mounted.current)
          setRoutineRuns((current) => ({
            ...current,
            [routineId]: [
              run,
              ...(current[routineId] ?? []).filter(
                (candidate) => candidate.id !== run.id,
              ),
            ],
          }));
        const completed = await client.waitForRoutineRun(run.id, {
          onUpdate: (update) => {
            if (mounted.current)
              setRoutineRuns((current) => ({
                ...current,
                [routineId]: [
                  update,
                  ...(current[routineId] ?? []).filter(
                    (candidate) => candidate.id !== update.id,
                  ),
                ],
              }));
          },
        });
        await refreshResources();
        return completed;
      } catch (cause) {
        if (mounted.current)
          setError(errorMessage(cause, 'Vera could not run that routine.'));
        return undefined;
      } finally {
        if (mounted.current) setRoutineActionId(undefined);
      }
    },
    [client, refreshResources],
  );

  async function toggleVoiceInput(): Promise<void> {
    setError(undefined);
    if (voiceInput.phase === 'recording') {
      voiceInput.stop('review');
      return;
    }
    await spokenReply.stop();
    await voiceInput.start(draft);
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
          attention={attention?.items.length ?? 0}
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
            attentionItems={attention?.items.length ?? 0}
            compact={compact}
            projects={projects}
            selectedProjectId={selectedProjectId}
            title={conversation?.title}
            refreshing={refreshing}
            onMenu={() => setSidebarOpen(true)}
            onRefresh={() => void refreshAssistant()}
            onResources={() => openResources('attention')}
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
            onRemoveAttachment={removeAttachment}
            onRetryAttachment={retryAttachment}
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
          attention={attention}
          focusedAttentionItemId={focusedAttentionItemId}
          compact={compact}
          memories={memories}
          knowledgeSources={knowledgeSources}
          machines={machines}
          projects={projects}
          campaigns={campaigns}
          missions={missions}
          routines={routines}
          routineRuns={routineRuns}
          routineActionId={routineActionId}
          integrations={integrationConnections.integrations}
          integrationConnections={integrationConnections.connections}
          integrationActionId={integrationConnections.actionId}
          campaignPolicies={campaignPolicies}
          notifications={notifications}
          pushNotifications={pushNotifications}
          open={resources.open}
          reminders={reminders}
          tab={resources.tab}
          tasks={tasks}
          onClose={() =>
            setResources((current) => ({ ...current, open: false }))
          }
          onAttentionDecision={decideAttention}
          onHandleAttention={handleAttention}
          onOpenAttention={(item) => void openAttentionItem(item)}
          onOpenNotification={(notification) =>
            void openNotificationItem(notification)
          }
          onMemoryCommand={(command) => {
            setResources((current) => ({ ...current, open: false }));
            void send(command);
          }}
          onKnowledgeCommand={(command) => {
            setResources((current) => ({ ...current, open: false }));
            setDraft(command);
            setDraftFromVoice(false);
          }}
          onSearchKnowledge={searchKnowledge}
          onRemoveKnowledge={removeKnowledge}
          onMachineCommand={(command) => {
            setResources((current) => ({ ...current, open: false }));
            void send(command);
          }}
          onCreateCampaign={createCampaign}
          onCampaignDecision={decideCampaign}
          onCampaignCancel={cancelCampaign}
          onCampaignRepairRequest={requestCampaignRepair}
          onCampaignRepairDecision={decideCampaignRepair}
          onMissionDecision={decideMission}
          onMissionCancel={cancelMission}
          onCreateRoutine={createRoutine}
          onCreateExternalWatch={createExternalWatch}
          onRoutineDecision={routineDecision}
          onPauseRoutine={pauseRoutine}
          onResumeRoutine={resumeRoutine}
          onRunRoutineNow={runRoutineNow}
          onConnectIntegration={integrationConnections.connect}
          onVerifyIntegration={integrationConnections.verify}
          onRevokeIntegration={integrationConnections.revoke}
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
