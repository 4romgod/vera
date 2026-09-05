import { useState } from 'react';
import {
  Archive,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RotateCcw,
  Sparkles,
  SquareArrowOutUpRight,
} from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { AttentionBriefing, AttentionItem } from '@vera/client';

import { palette, radius, spacing } from '@/design/tokens';

export function AttentionPanel(props: {
  briefing?: AttentionBriefing;
  focusedItemId?: string;
  onDecision: (
    item: AttentionItem,
    decision: 'dismiss' | 'snooze' | 'restore',
  ) => Promise<boolean>;
  onOpen: (item: AttentionItem) => void;
  onHandle: (item: AttentionItem) => Promise<boolean>;
}) {
  const [busyId, setBusyId] = useState<string>();
  const [showResolved, setShowResolved] = useState(false);

  if (props.briefing === undefined) {
    return (
      <EmptyAttention
        title="Building your briefing"
        description="Vera is checking approvals, failures, tasks, reminders, and autonomous work."
      />
    );
  }

  async function decide(
    item: AttentionItem,
    decision: 'dismiss' | 'snooze' | 'restore',
  ): Promise<void> {
    if (busyId !== undefined) return;
    setBusyId(item.id);
    try {
      await props.onDecision(item, decision);
    } finally {
      setBusyId(undefined);
    }
  }

  async function handle(item: AttentionItem): Promise<void> {
    if (busyId !== undefined) return;
    setBusyId(item.id);
    try {
      await props.onHandle(item);
    } finally {
      setBusyId(undefined);
    }
  }

  const hidden = [
    ...props.briefing.snoozedItems,
    ...props.briefing.dismissedItems,
  ];

  return (
    <View style={{ gap: spacing.lg }}>
      <View
        style={{
          gap: spacing.md,
          borderWidth: 1,
          borderColor: palette.accentLine,
          borderRadius: radius.xl,
          padding: spacing.lg,
          backgroundColor: palette.accentSurface,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <View style={{ minWidth: 0, flex: 1, gap: spacing.xs }}>
            <Text
              selectable
              style={{
                color: palette.accent,
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 1,
              }}
            >
              YOUR BRIEFING
            </Text>
            <Text
              selectable
              style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}
            >
              {props.briefing.headline}
            </Text>
          </View>
          <View
            style={{
              minWidth: 52,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.lg,
              backgroundColor: palette.accentSurfaceStrong,
            }}
          >
            <Text
              style={{
                color: palette.accentStrong,
                fontSize: 23,
                fontWeight: '800',
                fontVariant: ['tabular-nums'],
              }}
            >
              {props.briefing.items.length}
            </Text>
          </View>
        </View>
        <Text
          selectable
          style={{ color: palette.textSoft, fontSize: 14, lineHeight: 21 }}
        >
          {props.briefing.summary}
        </Text>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <Count label="Urgent" value={props.briefing.counts.urgent} />
          <Count label="High" value={props.briefing.counts.high} />
          <Count label="Later" value={props.briefing.counts.normal} />
        </View>
      </View>

      {props.briefing.items.length === 0 ? (
        <EmptyAttention
          title="Nothing needs you right now"
          description="Vera will surface approvals, failures, overdue work, and upcoming reminders here."
        />
      ) : (
        props.briefing.items.map((item) => (
          <AttentionCard
            busy={busyId === item.id}
            item={item}
            focused={item.id === props.focusedItemId}
            key={item.id}
            onDismiss={() => void decide(item, 'dismiss')}
            onHandle={() => void handle(item)}
            onOpen={() => props.onOpen(item)}
            onSnooze={() => void decide(item, 'snooze')}
          />
        ))
      )}

      {hidden.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showResolved }}
            onPress={() => setShowResolved((current) => !current)}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{ color: palette.muted, fontSize: 13, fontWeight: '600' }}
            >
              {hidden.length} snoozed or dismissed
            </Text>
            <RotateCcw color={palette.faint} size={16} />
          </Pressable>
          {showResolved
            ? hidden.map((item) => (
                <View
                  key={item.id}
                  style={{
                    gap: spacing.sm,
                    borderWidth: 1,
                    borderColor: palette.lineSoft,
                    borderRadius: radius.lg,
                    padding: spacing.md,
                    backgroundColor: palette.surface,
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: palette.textSoft,
                      fontSize: 14,
                      fontWeight: '600',
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    selectable
                    style={{ color: palette.faint, fontSize: 12 }}
                  >
                    {item.state === 'snoozed' && item.snoozedUntil !== undefined
                      ? `Snoozed until ${formatTime(item.snoozedUntil)}`
                      : 'Dismissed from this briefing'}
                  </Text>
                  <ActionButton
                    disabled={busyId !== undefined}
                    icon={RotateCcw}
                    label="Restore"
                    onPress={() => void decide(item, 'restore')}
                  />
                </View>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

function AttentionCard(props: {
  item: AttentionItem;
  focused: boolean;
  busy: boolean;
  onOpen: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
  onHandle: () => void;
}) {
  const priorityLabel =
    props.item.priority === 'urgent'
      ? 'Needs you now'
      : props.item.priority === 'high'
        ? 'Important'
        : 'For your radar';
  return (
    <View
      style={{
        gap: spacing.md,
        borderWidth: 1,
        borderColor:
          props.focused || props.item.priority === 'urgent'
            ? palette.accentLine
            : palette.line,
        borderRadius: radius.lg,
        padding: spacing.lg,
        backgroundColor: palette.surface,
      }}
    >
      {props.focused ? (
        <Text
          style={{ color: palette.accent, fontSize: 10, fontWeight: '800' }}
        >
          OPENED FROM NOTIFICATION
        </Text>
      ) : null}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        <BellRing
          color={
            props.item.priority === 'urgent' ? palette.accent : palette.muted
          }
          size={16}
        />
        <Text
          style={{
            color:
              props.item.priority === 'urgent' ? palette.accent : palette.muted,
            fontSize: 10,
            fontWeight: '800',
            letterSpacing: 0.8,
          }}
        >
          {priorityLabel.toUpperCase()}
        </Text>
        <Text
          style={{ marginLeft: 'auto', color: palette.faint, fontSize: 10 }}
        >
          {formatTime(props.item.occurredAt)}
        </Text>
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          style={{
            color: palette.text,
            fontSize: 17,
            fontWeight: '700',
            lineHeight: 23,
          }}
        >
          {props.item.title}
        </Text>
        <Text
          selectable
          style={{ color: palette.textSoft, fontSize: 13, lineHeight: 20 }}
        >
          {props.item.summary}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {props.item.target.kind === 'external_signal' ? (
          <ActionButton
            disabled={props.busy}
            emphasized
            icon={Sparkles}
            label={
              props.item.target.conversationId === undefined
                ? 'Handle with Vera'
                : 'Continue with Vera'
            }
            onPress={props.onHandle}
          />
        ) : null}
        <ActionButton
          icon={
            props.item.target.kind === 'external_signal'
              ? SquareArrowOutUpRight
              : ChevronRight
          }
          label={
            props.item.target.kind === 'external_signal'
              ? 'View source'
              : 'Open'
          }
          onPress={props.onOpen}
        />
        <ActionButton
          disabled={props.busy}
          icon={Clock3}
          label="1 hour"
          onPress={props.onSnooze}
        />
        <ActionButton
          disabled={props.busy}
          icon={Archive}
          label="Dismiss"
          onPress={props.onDismiss}
        />
      </View>
    </View>
  );
}

function ActionButton(props: {
  icon: typeof Archive;
  label: string;
  disabled?: boolean;
  emphasized?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: props.emphasized ? palette.accentLine : palette.line,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        opacity: props.disabled ? 0.4 : pressed ? 0.7 : 1,
        backgroundColor: props.emphasized
          ? palette.accentSurface
          : palette.surfaceRaised,
      })}
    >
      <Icon
        color={props.emphasized ? palette.accent : palette.textSoft}
        size={14}
      />
      <Text
        style={{
          color: props.emphasized ? palette.text : palette.textSoft,
          fontSize: 12,
          fontWeight: '600',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function Count(props: { label: string; value: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 5,
        borderRadius: radius.pill,
        paddingHorizontal: 9,
        paddingVertical: 6,
        backgroundColor: palette.surface,
      }}
    >
      <Text
        style={{
          color: palette.text,
          fontSize: 11,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}
      >
        {props.value}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 11 }}>{props.label}</Text>
    </View>
  );
}

function EmptyAttention(props: { title: string; description: string }) {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xxxl,
      }}
    >
      <CheckCircle2 color={palette.accent} size={28} strokeWidth={1.5} />
      <Text
        selectable
        style={{
          color: palette.text,
          fontSize: 16,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {props.title}
      </Text>
      <Text
        selectable
        style={{
          color: palette.muted,
          fontSize: 13,
          lineHeight: 20,
          textAlign: 'center',
        }}
      >
        {props.description}
      </Text>
    </View>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
