import { useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  MemoryResource,
  NotificationResource,
  PersonalTaskResource,
  ReminderResource,
} from '@vera/client';

export type ResourceTab = 'memory' | 'tasks' | 'reminders' | 'notifications';

export function ResourcePanel(props: {
  compact: boolean;
  open: boolean;
  tab: ResourceTab;
  memories: MemoryResource[];
  tasks: PersonalTaskResource[];
  reminders: ReminderResource[];
  notifications: NotificationResource[];
  onTab: (tab: ResourceTab) => void;
  onClose: () => void;
  onMemoryCommand: (command: string) => void;
}) {
  const panel = <PanelContent {...props} />;
  if (!props.compact) return props.open ? panel : null;
  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      transparent
      visible={props.open}
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}
      >
        {panel}
      </View>
    </Modal>
  );
}

function PanelContent(
  props: Omit<Parameters<typeof ResourcePanel>[0], 'compact'>,
) {
  const [editingMemoryId, setEditingMemoryId] = useState<string>();
  const [correction, setCorrection] = useState('');
  const tabs: ResourceTab[] = ['memory', 'tasks', 'reminders', 'notifications'];
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 420,
        maxHeight: '92%',
        alignSelf: 'flex-end',
        borderLeftWidth: 1,
        borderTopWidth: 1,
        borderColor: '#20262d',
        borderCurve: 'continuous',
        borderTopLeftRadius: 22,
        padding: 18,
        backgroundColor: '#0e1217',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ gap: 3 }}>
          <Text selectable style={{ color: '#68d6ac', fontSize: 10 }}>
            OWNER DATA
          </Text>
          <Text selectable style={{ color: '#eef2f0', fontSize: 20 }}>
            Your Vera
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={props.onClose}>
          <Text style={{ color: '#9aa39f', fontSize: 22 }}>×</Text>
        </Pressable>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 7,
          paddingVertical: 16,
        }}
      >
        {tabs.map((tab) => (
          <Pressable
            accessibilityRole="button"
            key={tab}
            onPress={() => props.onTab(tab)}
            style={{
              borderRadius: 999,
              paddingHorizontal: 11,
              paddingVertical: 7,
              backgroundColor: props.tab === tab ? '#26352f' : '#151a20',
            }}
          >
            <Text
              style={{
                color: props.tab === tab ? '#dff9ee' : '#7c8782',
                fontSize: 11,
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ gap: 10, paddingBottom: 32 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {props.tab === 'memory' && props.memories.length === 0 ? (
          <Empty label="No active memories yet" />
        ) : null}
        {props.tab === 'memory'
          ? props.memories.map((memory) => (
              <ResourceCard key={memory.id}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  }}
                >
                  <Tag label={memory.kind.replace('_', ' ')} />
                  <Text selectable style={{ color: '#6e7874', fontSize: 11 }}>
                    r{memory.revision}
                  </Text>
                </View>
                <Text selectable style={{ color: '#eef2f0', fontSize: 15 }}>
                  {memory.subject}
                </Text>
                <Text selectable style={{ color: '#abb4b0', lineHeight: 20 }}>
                  {memory.content}
                </Text>
                <Text selectable style={{ color: '#737e79', fontSize: 11 }}>
                  {memory.scope.kind === 'global'
                    ? 'Global'
                    : `Project · ${memory.scope.projectId}`}{' '}
                  · {memory.sensitivity}
                </Text>
                {editingMemoryId === memory.id ? (
                  <View style={{ gap: 9 }}>
                    <TextInput
                      accessibilityLabel="Correct memory"
                      multiline
                      onChangeText={setCorrection}
                      style={{
                        minHeight: 72,
                        borderWidth: 1,
                        borderColor: '#35413d',
                        borderRadius: 10,
                        padding: 10,
                        color: '#e7ece9',
                        textAlignVertical: 'top',
                        backgroundColor: '#0a0f0d',
                      }}
                      value={correction}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <SmallButton
                        label="Cancel"
                        onPress={() => setEditingMemoryId(undefined)}
                      />
                      <SmallButton
                        disabled={
                          correction.trim().length === 0 ||
                          correction.trim() === memory.content
                        }
                        label="Propose correction"
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
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <SmallButton
                      label="Correct"
                      onPress={() => {
                        setEditingMemoryId(memory.id);
                        setCorrection(memory.content);
                      }}
                    />
                    <SmallButton
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
          <Empty label="No open tasks" />
        ) : null}
        {props.tab === 'tasks'
          ? props.tasks.map((task) => (
              <ResourceCard key={task.id}>
                <Tag label={task.status} />
                <Text selectable style={{ color: '#eef2f0' }}>
                  {task.title}
                </Text>
                <Text selectable style={{ color: '#737e79', fontSize: 11 }}>
                  {task.dueAt ?? 'No due date'}
                </Text>
              </ResourceCard>
            ))
          : null}
        {props.tab === 'reminders' && props.reminders.length === 0 ? (
          <Empty label="No scheduled reminders" />
        ) : null}
        {props.tab === 'reminders'
          ? props.reminders.map((reminder) => (
              <ResourceCard key={reminder.id}>
                <Tag label={reminder.status} />
                <Text selectable style={{ color: '#eef2f0' }}>
                  {reminder.message}
                </Text>
                <Text selectable style={{ color: '#737e79', fontSize: 11 }}>
                  {new Date(reminder.scheduledFor).toLocaleString()}
                </Text>
              </ResourceCard>
            ))
          : null}
        {props.tab === 'notifications' && props.notifications.length === 0 ? (
          <Empty label="Inbox is clear" />
        ) : null}
        {props.tab === 'notifications'
          ? props.notifications.map((notification) => (
              <ResourceCard key={notification.id}>
                <Tag label={notification.status} />
                <Text selectable style={{ color: '#eef2f0' }}>
                  {notification.message}
                </Text>
                <Text selectable style={{ color: '#737e79', fontSize: 11 }}>
                  {new Date(notification.deliveredAt).toLocaleString()}
                </Text>
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
        gap: 10,
        borderWidth: 1,
        borderColor: '#252c33',
        borderCurve: 'continuous',
        borderRadius: 14,
        padding: 15,
        backgroundColor: '#151a20',
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
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        color: '#69d8ae',
        fontSize: 9,
        textTransform: 'uppercase',
        backgroundColor: '#20342d',
      }}
    >
      {props.label}
    </Text>
  );
}

function SmallButton(props: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: '#354039',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
        opacity: props.disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: '#adb7b2', fontSize: 11 }}>{props.label}</Text>
    </Pressable>
  );
}

function Empty(props: { label: string }) {
  return (
    <Text
      selectable
      style={{ paddingVertical: 72, color: '#69736f', textAlign: 'center' }}
    >
      {props.label}
    </Text>
  );
}
