import { useState, type ReactNode } from 'react';
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
} from 'lucide-react-native';
import {
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
} from '@vera/client';

import { IconButton } from '@/components/ui/icon-button';
import { layout, palette, radius, shadow, spacing } from '@/design/tokens';
import { humanizeIdentifier } from './assistant/presentation';

export type ResourceTab =
  | 'memory'
  | 'tasks'
  | 'reminders'
  | 'notifications'
  | 'machines';

const tabs: { id: ResourceTab; label: string; icon: typeof Brain }[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'reminders', label: 'Reminders', icon: CalendarClock },
  { id: 'notifications', label: 'Activity', icon: Bell },
  { id: 'machines', label: 'Machines', icon: ServerCog },
];

export function ResourcePanel(props: {
  compact: boolean;
  open: boolean;
  tab: ResourceTab;
  memories: MemoryResource[];
  tasks: PersonalTaskResource[];
  reminders: ReminderResource[];
  notifications: NotificationResource[];
  machines: MachineCatalogResource['machines'];
  onTab: (tab: ResourceTab) => void;
  onClose: () => void;
  onMemoryCommand: (command: string) => void;
  onMachineCommand: (command: string) => void;
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
      </ScrollView>
    </View>
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
