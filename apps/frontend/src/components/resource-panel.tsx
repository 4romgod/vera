import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  Brain,
  CalendarClock,
  Check,
  ListChecks,
  Pencil,
  Trash2,
  X,
  ServerCog,
  Activity,
  ExternalLink,
  Rocket,
  Library,
  Search,
  CircleAlert,
} from 'lucide-react-native';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  MemoryResource,
  NotificationResource,
  PersonalTaskResource,
  ReminderResource,
  MachineCatalogResource,
  DevelopmentCampaignResource,
  DevelopmentCampaignPolicyResource,
  MissionResource,
  KnowledgeSearchResponse,
  KnowledgeSourceResource,
  AttentionBriefing,
  AttentionItem,
} from '@vera/client';

import { IconButton } from '@/components/ui/icon-button';
import { layout, palette, radius, shadow, spacing } from '@/design/tokens';
import { humanizeIdentifier } from './assistant/presentation';
import { isSafeGitHubPullRequestUrl } from './assistant/software-delivery/model';
import { AttentionPanel } from './attention/attention-panel';

export type ResourceTab =
  | 'attention'
  | 'memory'
  | 'knowledge'
  | 'tasks'
  | 'reminders'
  | 'notifications'
  | 'machines'
  | 'missions'
  | 'campaigns';

const tabs: { id: ResourceTab; label: string; icon: typeof Brain }[] = [
  { id: 'attention', label: 'Today', icon: CircleAlert },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'knowledge', label: 'Knowledge', icon: Library },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'reminders', label: 'Reminders', icon: CalendarClock },
  { id: 'notifications', label: 'Activity', icon: Bell },
  { id: 'machines', label: 'Machines', icon: ServerCog },
  { id: 'missions', label: 'Missions', icon: Rocket },
  { id: 'campaigns', label: 'Campaigns', icon: Rocket },
];

export function ResourcePanel(props: {
  compact: boolean;
  open: boolean;
  tab: ResourceTab;
  attention?: AttentionBriefing;
  memories: MemoryResource[];
  knowledgeSources: KnowledgeSourceResource[];
  tasks: PersonalTaskResource[];
  reminders: ReminderResource[];
  notifications: NotificationResource[];
  machines: MachineCatalogResource['machines'];
  campaigns: DevelopmentCampaignResource[];
  campaignPolicies: DevelopmentCampaignPolicyResource[];
  missions: MissionResource[];
  onTab: (tab: ResourceTab) => void;
  onAttentionDecision: (
    item: AttentionItem,
    decision: 'dismiss' | 'snooze' | 'restore',
  ) => Promise<boolean>;
  onOpenAttention: (item: AttentionItem) => void;
  onClose: () => void;
  onMemoryCommand: (command: string) => void;
  onKnowledgeCommand: (command: string) => void;
  onSearchKnowledge: (query: string) => Promise<KnowledgeSearchResponse>;
  onRemoveKnowledge: (sourceId: string) => Promise<boolean>;
  onMachineCommand: (command: string) => void;
  onCreateCampaign: (input: {
    projectId: string;
    policyId: string;
    objective: string;
  }) => Promise<boolean>;
  onCampaignDecision: (
    campaignId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onCampaignCancel: (campaignId: string) => Promise<boolean>;
  onMissionDecision: (
    missionId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onMissionCancel: (missionId: string) => Promise<boolean>;
}) {
  if (!props.open) return null;
  const content = <PanelContent {...props} />;
  if (!props.compact) return content;
  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      transparent
      visible
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: palette.scrim,
        }}
      >
        <Pressable
          accessibilityLabel="Close your Vera"
          accessibilityRole="button"
          onPress={props.onClose}
          style={{ flex: 1 }}
        />
        {content}
      </View>
    </Modal>
  );
}

function PanelContent(props: Parameters<typeof ResourcePanel>[0]) {
  const insets = useSafeAreaInsets();
  const [editingMemoryId, setEditingMemoryId] = useState<string>();
  const [correction, setCorrection] = useState('');
  const [campaignPolicyId, setCampaignPolicyId] = useState(
    props.campaignPolicies[0]?.id ?? '',
  );
  const [campaignObjective, setCampaignObjective] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [campaignActionId, setCampaignActionId] = useState<string>();
  const [missionActionId, setMissionActionId] = useState<string>();
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeSearch, setKnowledgeSearch] =
    useState<KnowledgeSearchResponse>();
  const [knowledgeSearchError, setKnowledgeSearchError] = useState<string>();
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const [confirmingKnowledgeId, setConfirmingKnowledgeId] = useState<string>();
  const [removingKnowledgeId, setRemovingKnowledgeId] = useState<string>();
  const knowledgeSearchGeneration = useRef(0);
  const campaignPolicy = props.campaignPolicies.find(
    (policy) => policy.id === campaignPolicyId,
  );
  useEffect(() => {
    if (
      campaignPolicyId.length === 0 ||
      !props.campaignPolicies.some((policy) => policy.id === campaignPolicyId)
    ) {
      setCampaignPolicyId(props.campaignPolicies[0]?.id ?? '');
    }
  }, [campaignPolicyId, props.campaignPolicies]);
  useEffect(
    () => () => {
      knowledgeSearchGeneration.current += 1;
    },
    [],
  );

  function runKnowledgeSearch(): void {
    const query = knowledgeQuery.trim();
    if (query.length === 0 || knowledgeSearching) return;
    const generation = ++knowledgeSearchGeneration.current;
    setKnowledgeSearching(true);
    setKnowledgeSearchError(undefined);
    void props
      .onSearchKnowledge(query)
      .then((result) => {
        if (knowledgeSearchGeneration.current === generation) {
          setKnowledgeSearch(result);
        }
      })
      .catch(() => {
        if (knowledgeSearchGeneration.current === generation) {
          setKnowledgeSearchError(
            'Vera could not search your knowledge right now.',
          );
        }
      })
      .finally(() => {
        if (knowledgeSearchGeneration.current === generation) {
          setKnowledgeSearching(false);
        }
      });
  }
  return (
    <View
      style={{
        width: props.compact ? '100%' : layout.inspectorWidth,
        maxHeight: props.compact ? '92%' : '100%',
        alignSelf: 'flex-end',
        borderLeftWidth: props.compact ? 0 : 1,
        borderTopWidth: props.compact ? 1 : 0,
        borderColor: palette.line,
        borderTopLeftRadius: props.compact ? radius.xl : 0,
        borderTopRightRadius: props.compact ? radius.xl : 0,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: props.compact
          ? Math.max(insets.bottom, spacing.lg)
          : spacing.lg,
        backgroundColor: palette.canvasRaised,
        boxShadow: shadow.floating,
      }}
    >
      {props.compact ? (
        <View
          style={{
            width: 42,
            height: 4,
            alignSelf: 'center',
            borderRadius: radius.pill,
            backgroundColor: palette.line,
          }}
        />
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: spacing.md,
          paddingBottom: spacing.lg,
        }}
      >
        <View style={{ gap: 3 }}>
          <Text
            selectable
            style={{
              color: palette.accent,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 0.9,
            }}
          >
            VERA WORKSPACE
          </Text>
          <Text
            selectable
            style={{
              color: palette.text,
              fontSize: 23,
              fontWeight: '700',
              letterSpacing: -0.5,
            }}
          >
            Your Vera
          </Text>
        </View>
        <IconButton icon={X} label="Close your Vera" onPress={props.onClose} />
      </View>

      <ScrollView
        contentContainerStyle={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingBottom: spacing.lg,
        }}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = props.tab === tab.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={tab.id}
              onPress={() => props.onTab(tab.id)}
              style={({ pressed }) => ({
                minHeight: 42,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                borderWidth: 1,
                borderColor: selected ? palette.accentLine : palette.lineSoft,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                opacity: pressed ? 0.7 : 1,
                backgroundColor: selected
                  ? palette.accentSurface
                  : palette.surface,
              })}
            >
              <Icon
                color={selected ? palette.accent : palette.muted}
                size={15}
                strokeWidth={1.8}
              />
              <Text
                style={{
                  color: selected ? palette.text : palette.muted,
                  fontSize: 12,
                  fontWeight: selected ? '600' : '500',
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: spacing.md,
          paddingBottom: spacing.xxxl,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {props.tab === 'attention' ? (
          <AttentionPanel
            briefing={props.attention}
            onDecision={props.onAttentionDecision}
            onOpen={props.onOpenAttention}
          />
        ) : null}
        {props.tab === 'memory' && props.memories.length === 0 ? (
          <Empty
            icon={Brain}
            title="Nothing remembered yet"
            description="When you ask Vera to remember something, it will appear here after approval."
          />
        ) : null}
        {props.tab === 'memory'
          ? props.memories.map((memory) => (
              <ResourceCard key={memory.id}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <Tag label={humanizeIdentifier(memory.kind)} />
                  <Text
                    selectable
                    style={{
                      color: palette.faint,
                      fontSize: 10,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    Revision {memory.revision}
                  </Text>
                </View>
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 16,
                    fontWeight: '600',
                  }}
                >
                  {memory.subject}
                </Text>
                <Text
                  selectable
                  style={{ color: palette.textSoft, lineHeight: 21 }}
                >
                  {memory.content}
                </Text>
                <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
                  {memory.scope.kind === 'global'
                    ? 'Personal · All conversations'
                    : 'Project memory'}{' '}
                  · {humanizeIdentifier(memory.sensitivity)}
                </Text>
                {editingMemoryId === memory.id ? (
                  <View style={{ gap: spacing.sm }}>
                    <TextInput
                      accessibilityLabel="Correct memory"
                      multiline
                      onChangeText={setCorrection}
                      style={{
                        minHeight: 82,
                        borderWidth: 1,
                        borderColor: palette.line,
                        borderRadius: radius.md,
                        padding: spacing.md,
                        color: palette.text,
                        textAlignVertical: 'top',
                        backgroundColor: palette.canvas,
                      }}
                      value={correction}
                    />
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'flex-end',
                        gap: spacing.sm,
                      }}
                    >
                      <SmallButton
                        label="Cancel"
                        onPress={() => setEditingMemoryId(undefined)}
                      />
                      <SmallButton
                        disabled={
                          correction.trim().length === 0 ||
                          correction.trim() === memory.content
                        }
                        icon={Check}
                        label="Propose correction"
                        primary
                        onPress={() => {
                          setEditingMemoryId(undefined);
                          props.onMemoryCommand(
                            `Correct memory ${memory.id}. Its new content is: ${correction.trim()}`,
                          );
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <SmallButton
                      icon={Pencil}
                      label="Correct"
                      onPress={() => {
                        setEditingMemoryId(memory.id);
                        setCorrection(memory.content);
                      }}
                    />
                    <SmallButton
                      icon={Trash2}
                      label="Forget"
                      onPress={() =>
                        props.onMemoryCommand(`Forget memory ${memory.id}.`)
                      }
                    />
                  </View>
                )}
              </ResourceCard>
            ))
          : null}

        {props.tab === 'knowledge' ? (
          <ResourceCard>
            <Tag label="Grounded library" />
            <Text
              selectable
              style={{ color: palette.text, fontSize: 17, fontWeight: '700' }}
            >
              Ask your own sources
            </Text>
            <Text
              selectable
              style={{ color: palette.textSoft, lineHeight: 20 }}
            >
              Searches stay grounded in the files you deliberately saved. Every
              match includes the exact source and location.
            </Text>
            <SmallButton
              icon={Library}
              label="Add files to knowledge"
              onPress={() =>
                props.onKnowledgeCommand(
                  'Save the files I attach to my knowledge library as ',
                )
              }
            />
            <TextInput
              accessibilityLabel="Search Vera knowledge"
              maxLength={2_000}
              onChangeText={setKnowledgeQuery}
              onSubmitEditing={runKnowledgeSearch}
              placeholder="What did my sources say about…"
              placeholderTextColor={palette.faint}
              returnKeyType="search"
              style={inputStyle}
              value={knowledgeQuery}
            />
            <SmallButton
              disabled={
                knowledgeSearching || knowledgeQuery.trim().length === 0
              }
              icon={Search}
              label={knowledgeSearching ? 'Searching…' : 'Search sources'}
              primary
              onPress={runKnowledgeSearch}
            />
            {knowledgeSearchError === undefined ? null : (
              <Text accessibilityRole="alert" style={{ color: palette.danger }}>
                {knowledgeSearchError}
              </Text>
            )}
            {knowledgeSearch === undefined ? null : knowledgeSearch.citations
                .length === 0 ? (
              <Text selectable style={{ color: palette.muted, lineHeight: 20 }}>
                No active source matched that query.
              </Text>
            ) : (
              <View style={{ gap: spacing.md }}>
                {knowledgeSearch.citations.map((citation) => (
                  <View
                    key={citation.chunkId}
                    style={{
                      gap: 5,
                      borderLeftWidth: 2,
                      borderLeftColor: palette.accentLine,
                      paddingLeft: spacing.md,
                    }}
                  >
                    <Text
                      selectable
                      style={{ color: palette.accent, fontWeight: '700' }}
                    >
                      {citation.sourceTitle}
                    </Text>
                    <Text
                      selectable
                      style={{ color: palette.muted, fontSize: 11 }}
                    >
                      {citation.locator}
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: palette.textSoft,
                        fontSize: 13,
                        lineHeight: 19,
                      }}
                    >
                      “{citation.excerpt}”
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ResourceCard>
        ) : null}

        {props.tab === 'knowledge' && props.knowledgeSources.length === 0 ? (
          <Empty
            icon={Library}
            title="Your knowledge library is empty"
            description="Attach a document or image in a conversation, then ask Vera to save it to your knowledge library. Vera will show the evidence and ask before writing."
          />
        ) : null}
        {props.tab === 'knowledge'
          ? props.knowledgeSources.map((source) => (
              <ResourceCard key={source.id}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <Tag
                    label={
                      source.scope.kind === 'global' ? 'Personal' : 'Project'
                    }
                  />
                  <Text
                    selectable
                    style={{ color: palette.faint, fontSize: 10 }}
                  >
                    {source.chunkCount} evidence chunk
                    {source.chunkCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 16,
                    fontWeight: '700',
                  }}
                >
                  {source.title}
                </Text>
                <Text
                  selectable
                  style={{ color: palette.textSoft, lineHeight: 20 }}
                >
                  {source.provenance.attachments
                    .map(({ filename }) => filename)
                    .join(', ')}
                </Text>
                <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
                  Added {formatDate(source.createdAt)} ·{' '}
                  {humanizeIdentifier(source.sensitivity)}
                </Text>
                {confirmingKnowledgeId === source.id ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <SmallButton
                      label="Keep"
                      onPress={() => setConfirmingKnowledgeId(undefined)}
                    />
                    <SmallButton
                      disabled={removingKnowledgeId !== undefined}
                      icon={Trash2}
                      label="Confirm removal"
                      onPress={() => {
                        setRemovingKnowledgeId(source.id);
                        void props
                          .onRemoveKnowledge(source.id)
                          .then((removed) => {
                            if (removed) setConfirmingKnowledgeId(undefined);
                          })
                          .finally(() => setRemovingKnowledgeId(undefined));
                      }}
                    />
                  </View>
                ) : (
                  <SmallButton
                    icon={Trash2}
                    label="Remove source"
                    onPress={() => setConfirmingKnowledgeId(source.id)}
                  />
                )}
              </ResourceCard>
            ))
          : null}

        {props.tab === 'tasks' && props.tasks.length === 0 ? (
          <Empty
            icon={ListChecks}
            title="No tasks yet"
            description="Ask Vera to create or track something you need to get done."
          />
        ) : null}
        {props.tab === 'tasks'
          ? props.tasks.map((task) => (
              <ResourceCard key={task.id}>
                <Tag label={task.status} />
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 16,
                    fontWeight: '600',
                  }}
                >
                  {task.title}
                </Text>
                {task.notes === undefined ? null : (
                  <Text
                    selectable
                    style={{ color: palette.textSoft, lineHeight: 20 }}
                  >
                    {task.notes}
                  </Text>
                )}
                <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
                  {task.dueAt === undefined
                    ? 'No due date'
                    : formatDate(task.dueAt)}
                </Text>
              </ResourceCard>
            ))
          : null}

        {props.tab === 'reminders' && props.reminders.length === 0 ? (
          <Empty
            icon={CalendarClock}
            title="No reminders scheduled"
            description="Ask Vera to remind you at a specific time."
          />
        ) : null}
        {props.tab === 'reminders'
          ? props.reminders.map((reminder) => (
              <ResourceCard key={reminder.id}>
                <Tag label={reminder.status} />
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 16,
                    fontWeight: '600',
                  }}
                >
                  {reminder.message}
                </Text>
                <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
                  {formatDate(reminder.scheduledFor)}
                </Text>
              </ResourceCard>
            ))
          : null}

        {props.tab === 'notifications' && props.notifications.length === 0 ? (
          <Empty
            icon={Bell}
            title="You are all caught up"
            description="Delivered reminders and important Vera activity will appear here."
          />
        ) : null}
        {props.tab === 'notifications'
          ? props.notifications.map((notification) => (
              <ResourceCard key={notification.id}>
                <Tag label={notification.status} />
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 16,
                    fontWeight: '600',
                  }}
                >
                  {notification.message}
                </Text>
                <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
                  {formatDate(notification.deliveredAt)}
                </Text>
              </ResourceCard>
            ))
          : null}

        {props.tab === 'machines' && props.machines.length === 0 ? (
          <Empty
            icon={ServerCog}
            title="No machines registered"
            description="Add an operator-owned machine catalog to let Vera inspect and control exact services."
          />
        ) : null}
        {props.tab === 'machines'
          ? props.machines.map((machine) => (
              <ResourceCard key={machine.id}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <Tag label={machine.adapter} />
                  <SmallButton
                    icon={Activity}
                    label="Inspect all"
                    primary
                    onPress={() =>
                      props.onMachineCommand(
                        `Inspect registered machine ${machine.id} and all of its services.`,
                      )
                    }
                  />
                </View>
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 17,
                    fontWeight: '700',
                  }}
                >
                  {machine.displayName}
                </Text>
                {machine.services.map((service) => (
                  <View
                    key={service.id}
                    style={{
                      gap: spacing.sm,
                      borderTopWidth: 1,
                      borderTopColor: palette.lineSoft,
                      paddingTop: spacing.md,
                    }}
                  >
                    <Text
                      selectable
                      style={{ color: palette.textSoft, fontWeight: '600' }}
                    >
                      {service.displayName}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: spacing.sm,
                      }}
                    >
                      <SmallButton
                        label="Inspect"
                        onPress={() =>
                          props.onMachineCommand(
                            `Inspect service ${service.id} on registered machine ${machine.id}.`,
                          )
                        }
                      />
                      {service.actions.map((action) => (
                        <SmallButton
                          key={action}
                          label={humanizeIdentifier(action)}
                          onPress={() =>
                            props.onMachineCommand(
                              `${action} service ${service.id} on registered machine ${machine.id}.`,
                            )
                          }
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </ResourceCard>
            ))
          : null}

        {props.tab === 'missions' && props.missions.length === 0 ? (
          <Empty
            icon={Rocket}
            title="No missions yet"
            description="Ask Vera to take one bounded software objective to a verified pull request while you are away."
          />
        ) : null}
        {props.tab === 'missions'
          ? props.missions.map((mission) => (
              <MissionCard
                busy={missionActionId !== undefined}
                key={mission.id}
                mission={mission}
                onCancel={() => {
                  setMissionActionId(mission.id);
                  void props
                    .onMissionCancel(mission.id)
                    .finally(() => setMissionActionId(undefined));
                }}
                onDecision={(decision) => {
                  setMissionActionId(mission.id);
                  void props
                    .onMissionDecision(mission.id, decision)
                    .finally(() => setMissionActionId(undefined));
                }}
              />
            ))
          : null}

        {props.tab === 'campaigns' ? (
          <ResourceCard>
            <Tag label="New governed campaign" />
            <Text
              selectable
              style={{ color: palette.text, fontSize: 17, fontWeight: '700' }}
            >
              Delegate one complete delivery cycle
            </Text>
            <Text
              selectable
              style={{ color: palette.textSoft, lineHeight: 20 }}
            >
              Vera will implement, verify, publish, observe CI, and finish only
              inside the selected operator policy.
            </Text>
            <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
              Operator policy
            </Text>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              {props.campaignPolicies.map((policy) => (
                <SmallButton
                  key={`${policy.project.id}:${policy.id}`}
                  label={`${policy.project.displayName} · ${policy.id}`}
                  primary={campaignPolicyId === policy.id}
                  onPress={() => setCampaignPolicyId(policy.id)}
                />
              ))}
            </View>
            {campaignPolicy === undefined ? (
              <Text selectable style={{ color: palette.muted, lineHeight: 20 }}>
                No campaign policy is available for a registered project. Ask
                the operator to configure the campaign catalog and restart Vera.
              </Text>
            ) : (
              <Text
                selectable
                style={{ color: palette.textSoft, lineHeight: 20 }}
              >
                {campaignPolicy.baseBranch} · {campaignPolicy.merge.method}{' '}
                merge ·{' '}
                {campaignPolicy.qualityGates
                  .map((gate) => gate.label)
                  .join(', ')}
              </Text>
            )}
            <TextInput
              accessibilityLabel="Development campaign objective"
              maxLength={10_000}
              multiline
              onChangeText={setCampaignObjective}
              placeholder="What should Vera build?"
              placeholderTextColor={palette.faint}
              style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
              value={campaignObjective}
            />
            <SmallButton
              disabled={
                creatingCampaign ||
                campaignPolicy === undefined ||
                campaignObjective.trim().length === 0
              }
              icon={Rocket}
              label="Prepare campaign approval"
              primary
              onPress={() => {
                if (campaignPolicy === undefined) return;
                setCreatingCampaign(true);
                void props
                  .onCreateCampaign({
                    projectId: campaignPolicy.project.id,
                    policyId: campaignPolicy.id,
                    objective: campaignObjective.trim(),
                  })
                  .then((created) => {
                    if (created) setCampaignObjective('');
                  })
                  .finally(() => setCreatingCampaign(false));
              }}
            />
          </ResourceCard>
        ) : null}
        {props.tab === 'campaigns' && props.campaigns.length === 0 ? (
          <Empty
            icon={Rocket}
            title="No development campaigns yet"
            description="Configure an operator policy, then prepare one bounded objective for approval."
          />
        ) : null}
        {props.tab === 'campaigns'
          ? props.campaigns.map((campaign) => (
              <CampaignCard
                campaign={campaign}
                busy={campaignActionId !== undefined}
                key={campaign.id}
                onCancel={() => {
                  setCampaignActionId(campaign.id);
                  void props
                    .onCampaignCancel(campaign.id)
                    .finally(() => setCampaignActionId(undefined));
                }}
                onDecision={(decision) => {
                  setCampaignActionId(campaign.id);
                  void props
                    .onCampaignDecision(campaign.id, decision)
                    .finally(() => setCampaignActionId(undefined));
                }}
              />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

const inputStyle = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: palette.line,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  color: palette.text,
  backgroundColor: palette.canvas,
} as const;

function CampaignCard(props: {
  campaign: DevelopmentCampaignResource;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => void;
  onCancel: () => void;
}) {
  const campaign = props.campaign;
  const effect = campaign.approval.effect;
  const missionControlled = effect.approvalController?.kind === 'mission';
  const cancellable = [
    'awaiting_approval',
    'approved',
    'implementing',
    'applying',
    'verifying',
  ].includes(campaign.status);
  return (
    <ResourceCard>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <Tag label={campaign.status} />
        <Text selectable style={{ color: palette.faint, fontSize: 10 }}>
          {campaign.attempts.length}/{effect.limits.maxAttempts} attempts
        </Text>
      </View>
      <Text
        selectable
        style={{ color: palette.text, fontSize: 16, fontWeight: '700' }}
      >
        {effect.objective}
      </Text>
      <Text selectable style={{ color: palette.textSoft, lineHeight: 20 }}>
        {effect.repository.owner}/{effect.repository.name} · {effect.baseBranch}{' '}
        · {effect.merge.method} merge
      </Text>
      <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
        Base: {effect.baseRevision.slice(0, 12)} · Ticket:{' '}
        {effect.ticket.reference}
      </Text>
      {missionControlled ? (
        <Text selectable style={{ color: palette.accent, fontSize: 11 }}>
          Approval is controlled by its bounded mission.
        </Text>
      ) : null}
      <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
        Gates: {effect.qualityGates.map((gate) => gate.label).join(', ')}
      </Text>
      <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
        Ceiling: {effect.limits.maxChangedFiles} files ·{' '}
        {effect.limits.maxChangedBytes.toLocaleString()} bytes ·{' '}
        {effect.limits.maxDurationMinutes} minutes
      </Text>
      {campaign.status === 'awaiting_approval' ? (
        <View style={{ gap: spacing.sm }}>
          <Text selectable style={{ color: palette.textSoft, lineHeight: 20 }}>
            Commit: {effect.delivery.commitMessage}
          </Text>
          <Text selectable style={{ color: palette.textSoft, lineHeight: 20 }}>
            Pull request: {effect.delivery.pullRequest.title}
          </Text>
          <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
            Protected: {effect.protectedPathPrefixes.join(', ')}
          </Text>
          <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
            Review approval:{' '}
            {effect.merge.requireReviewApproval ? 'required' : 'not required'} ·
            Local base sync:{' '}
            {effect.merge.synchronizeLocalBase ? 'enabled' : 'disabled'}
          </Text>
          <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
            No direct base push · No force push · No policy mutation
          </Text>
        </View>
      ) : null}
      {campaign.pullRequest === undefined ? null : (
        <View style={{ gap: spacing.sm }}>
          <Text selectable style={{ color: palette.accent, fontSize: 12 }}>
            Pull request #{campaign.pullRequest.number} ·{' '}
            {campaign.pullRequest.observation === undefined
              ? 'waiting for checks'
              : `${String(campaign.pullRequest.observation.checks.passed)}/${String(campaign.pullRequest.observation.checks.total)} checks passed`}
          </Text>
          <SmallButton
            disabled={!isSafeGitHubPullRequestUrl(campaign.pullRequest.url)}
            icon={ExternalLink}
            label="Open pull request"
            onPress={() => {
              if (isSafeGitHubPullRequestUrl(campaign.pullRequest?.url ?? '')) {
                void Linking.openURL(campaign.pullRequest?.url ?? '');
              }
            }}
          />
        </View>
      )}
      {campaign.failure === undefined ? null : (
        <Text selectable style={{ color: palette.danger, lineHeight: 20 }}>
          {campaign.failure.message}
        </Text>
      )}
      {campaign.status === 'awaiting_approval' &&
      campaign.approval.status === 'pending' &&
      !missionControlled ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <SmallButton
            disabled={props.busy}
            label="Reject"
            onPress={() => props.onDecision('rejected')}
          />
          <SmallButton
            disabled={props.busy}
            icon={Check}
            label="Approve bounded campaign"
            primary
            onPress={() => props.onDecision('approved')}
          />
        </View>
      ) : cancellable && !missionControlled ? (
        <SmallButton
          disabled={props.busy}
          label="Cancel campaign"
          onPress={props.onCancel}
        />
      ) : null}
    </ResourceCard>
  );
}

function MissionCard(props: {
  mission: MissionResource;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => void;
  onCancel: () => void;
}) {
  const { mission } = props;
  const effect = mission.approval.effect;
  const terminal = [
    'succeeded',
    'rejected',
    'review_required',
    'failed',
    'cancelled',
  ].includes(mission.status);
  return (
    <ResourceCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Tag label={mission.status} />
        <Text selectable style={{ color: palette.faint, fontSize: 10 }}>
          one campaign · no merge
        </Text>
      </View>
      <Text
        selectable
        style={{ color: palette.text, fontSize: 17, fontWeight: '700' }}
      >
        {effect.objective}
      </Text>
      <Text selectable style={{ color: palette.textSoft, lineHeight: 20 }}>
        Done when: {effect.completionCriteria}
      </Text>
      <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
        {effect.project.displayName} · {effect.limits.maxDurationMinutes} minute
        ceiling · pull request only
      </Text>
      <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
        Commit: {effect.campaign.effect.delivery.commitMessage}
      </Text>
      <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
        PR: {effect.campaign.effect.delivery.pullRequest.title}
      </Text>
      {mission.result === undefined ? null : (
        <SmallButton
          disabled={!isSafeGitHubPullRequestUrl(mission.result.pullRequestUrl)}
          icon={ExternalLink}
          label={`Open pull request #${String(mission.result.pullRequestNumber)}`}
          onPress={() => {
            const url = mission.result?.pullRequestUrl ?? '';
            if (isSafeGitHubPullRequestUrl(url)) void Linking.openURL(url);
          }}
        />
      )}
      {mission.failure === undefined ? null : (
        <Text selectable style={{ color: palette.danger, lineHeight: 20 }}>
          {mission.failure.message}
        </Text>
      )}
      {mission.status === 'awaiting_approval' &&
      mission.approval.status === 'pending' ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <SmallButton
            disabled={props.busy}
            label="Reject"
            onPress={() => props.onDecision('rejected')}
          />
          <SmallButton
            disabled={props.busy}
            icon={Check}
            label="Approve mission"
            primary
            onPress={() => props.onDecision('approved')}
          />
        </View>
      ) : terminal ? null : (
        <SmallButton
          disabled={props.busy}
          label="Cancel mission"
          onPress={props.onCancel}
        />
      )}
    </ResourceCard>
  );
}

function ResourceCard(props: { children: ReactNode }) {
  return (
    <View
      style={{
        gap: spacing.md,
        borderWidth: 1,
        borderColor: palette.lineSoft,
        borderCurve: 'continuous',
        borderRadius: radius.lg,
        padding: spacing.lg,
        backgroundColor: palette.surface,
      }}
    >
      {props.children}
    </View>
  );
}

function Tag(props: { label: string }) {
  return (
    <Text
      selectable
      style={{
        alignSelf: 'flex-start',
        borderRadius: radius.pill,
        paddingHorizontal: 9,
        paddingVertical: 4,
        color: palette.accentStrong,
        fontSize: 9,
        fontWeight: '700',
        textTransform: 'uppercase',
        backgroundColor: palette.accentSurface,
      }}
    >
      {humanizeIdentifier(props.label)}
    </Text>
  );
}

function SmallButton(props: {
  label: string;
  icon?: typeof Check;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderWidth: 1,
        borderColor: props.primary ? palette.accentLine : palette.line,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.md,
        opacity: props.disabled ? 0.35 : pressed ? 0.68 : 1,
        backgroundColor: props.primary ? palette.accentSurface : 'transparent',
      })}
    >
      {Icon === undefined ? null : (
        <Icon
          color={props.primary ? palette.accent : palette.muted}
          size={15}
          strokeWidth={1.8}
        />
      )}
      <Text
        style={{
          color: props.primary ? palette.text : palette.textSoft,
          fontSize: 11,
          fontWeight: '600',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function Empty(props: {
  icon: typeof Brain;
  title: string;
  description: string;
}) {
  const Icon = props.icon;
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
        paddingVertical: 72,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.lg,
          backgroundColor: palette.surface,
        }}
      >
        <Icon color={palette.accent} size={21} strokeWidth={1.8} />
      </View>
      <Text
        selectable
        style={{
          color: palette.text,
          fontSize: 16,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {props.title}
      </Text>
      <Text
        selectable
        style={{
          maxWidth: 280,
          color: palette.muted,
          fontSize: 12,
          lineHeight: 18,
          textAlign: 'center',
        }}
      >
        {props.description}
      </Text>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
