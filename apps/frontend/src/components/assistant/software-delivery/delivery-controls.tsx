import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { StructuredValue } from '@/components/structured-value';
import { palette, radius, spacing } from '@/design/tokens';

export function ApprovalSection(props: {
  eyebrow: string;
  title: string;
  message: string;
  facts: [string, string][];
  exact: unknown;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => void;
}) {
  const [exactOpen, setExactOpen] = useState(false);
  return (
    <View
      style={{
        gap: spacing.lg,
        borderWidth: 1,
        borderColor: palette.accentLine,
        borderRadius: radius.lg,
        padding: spacing.lg,
        backgroundColor: palette.accentSurface,
      }}
    >
      <SectionHeading
        icon={ShieldCheck}
        eyebrow={props.eyebrow}
        title={props.title}
        message={props.message}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {props.facts.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: exactOpen }}
        onPress={() => setExactOpen((current) => !current)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          borderColor: palette.lineSoft,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          opacity: pressed ? 0.65 : 1,
          backgroundColor: palette.canvasRaised,
        })}
      >
        <Text
          selectable
          style={{ color: palette.textSoft, fontSize: 12, fontWeight: '600' }}
        >
          Inspect exact authority and manifest
        </Text>
        {exactOpen ? (
          <ChevronUp color={palette.muted} size={16} />
        ) : (
          <ChevronDown color={palette.muted} size={16} />
        )}
      </Pressable>
      {exactOpen ? (
        <View
          style={{
            borderRadius: radius.md,
            padding: spacing.md,
            backgroundColor: palette.canvas,
          }}
        >
          <StructuredValue value={props.exact} />
        </View>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: spacing.sm,
        }}
      >
        <DeliveryButton
          label="Reject"
          icon={X}
          secondary
          danger
          disabled={props.busy}
          onPress={() => props.onDecision('rejected')}
        />
        <DeliveryButton
          label="Approve exact effect"
          icon={Check}
          disabled={props.busy}
          busy={props.busy}
          onPress={() => props.onDecision('approved')}
        />
      </View>
    </View>
  );
}

export function StagePrompt(props: {
  icon: typeof GitBranch;
  title: string;
  message: string;
  action: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        gap: spacing.md,
        borderTopWidth: 1,
        borderTopColor: palette.lineSoft,
        paddingTop: spacing.lg,
      }}
    >
      <SectionHeading
        icon={props.icon}
        title={props.title}
        message={props.message}
      />
      <DeliveryButton
        label={props.action}
        icon={props.icon}
        disabled={props.busy}
        busy={props.busy}
        onPress={props.onPress}
      />
    </View>
  );
}

export function SectionHeading(props: {
  icon: typeof GitBranch;
  eyebrow?: string;
  title: string;
  message: string;
}) {
  const Icon = props.icon;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.md,
          backgroundColor: palette.accentSurfaceStrong,
        }}
      >
        <Icon color={palette.accent} size={18} strokeWidth={1.9} />
      </View>
      <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
        {props.eyebrow === undefined ? null : (
          <Text
            selectable
            style={{
              color: palette.accent,
              fontSize: 9,
              fontWeight: '700',
              letterSpacing: 0.8,
            }}
          >
            {props.eyebrow}
          </Text>
        )}
        <Text
          selectable
          style={{ color: palette.text, fontSize: 16, fontWeight: '700' }}
        >
          {props.title}
        </Text>
        <Text
          selectable
          style={{ color: palette.textSoft, fontSize: 12, lineHeight: 18 }}
        >
          {props.message}
        </Text>
      </View>
    </View>
  );
}

export function SuccessNotice(props: { title: string; message: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        borderWidth: 1,
        borderColor: palette.accentLine,
        borderRadius: radius.md,
        padding: spacing.md,
        backgroundColor: palette.accentSurface,
      }}
    >
      <CheckCircle2 color={palette.accent} size={20} />
      <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
        <Text
          selectable
          style={{ color: palette.text, fontSize: 14, fontWeight: '700' }}
        >
          {props.title}
        </Text>
        <Text
          selectable
          style={{ color: palette.textSoft, fontSize: 12, lineHeight: 18 }}
        >
          {props.message}
        </Text>
      </View>
    </View>
  );
}

export function TerminalNotice(props: {
  status: string;
  failure?: string;
  retryLabel?: string;
  busy: boolean;
  onRetry?: () => void;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <InlineNotice
        danger={props.status === 'failed' || props.status === 'review_required'}
        message={
          props.failure ?? `This attempt was ${humanStatus(props.status)}.`
        }
      />
      {props.retryLabel === undefined || props.onRetry === undefined ? null : (
        <DeliveryButton
          label={props.retryLabel}
          icon={RefreshCw}
          secondary
          disabled={props.busy}
          onPress={props.onRetry}
        />
      )}
    </View>
  );
}

export function InlineNotice(props: {
  message: string;
  danger?: boolean;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: props.danger ? '#714047' : palette.line,
        borderRadius: radius.md,
        padding: spacing.md,
        backgroundColor: props.danger
          ? palette.dangerSurface
          : palette.canvasRaised,
      }}
    >
      <AlertTriangle
        color={props.danger ? palette.danger : palette.warning}
        size={17}
      />
      <Text
        selectable
        style={{
          minWidth: 0,
          flex: 1,
          color: palette.textSoft,
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {props.message}
      </Text>
      {props.action === undefined || props.onAction === undefined ? null : (
        <Pressable accessibilityRole="button" onPress={props.onAction}>
          <Text
            style={{ color: palette.accent, fontSize: 11, fontWeight: '700' }}
          >
            {props.action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function LoadingRow(props: { label: string }) {
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
        backgroundColor: palette.canvasRaised,
      }}
    >
      <ActivityIndicator color={palette.accent} size="small" />
      <Text
        selectable
        style={{ minWidth: 0, flex: 1, color: palette.textSoft, fontSize: 12 }}
      >
        {props.label}
      </Text>
    </View>
  );
}

export function Fact(props: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <View style={{ minWidth: 92, flexGrow: 1, gap: 3 }}>
      <Text
        selectable
        style={{
          color: palette.faint,
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.6,
        }}
      >
        {props.label.toUpperCase()}
      </Text>
      <Text
        selectable
        numberOfLines={2}
        style={{
          color: palette.textSoft,
          fontSize: 12,
          ...(props.numeric ? { fontVariant: ['tabular-nums'] as const } : {}),
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

export function StatusPill(props: { label: string }) {
  return (
    <Text
      selectable
      style={{
        minWidth: 47,
        borderRadius: radius.pill,
        paddingHorizontal: 7,
        paddingVertical: 3,
        color: palette.accentStrong,
        fontSize: 8,
        fontWeight: '700',
        textAlign: 'center',
        textTransform: 'uppercase',
        backgroundColor: palette.accentSurfaceStrong,
      }}
    >
      {props.label}
    </Text>
  );
}

export function Field(props: {
  label: string;
  value: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        selectable
        style={{
          color: palette.muted,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.6,
        }}
      >
        {props.label.toUpperCase()}
      </Text>
      <TextInput
        accessibilityLabel={props.label}
        multiline={props.multiline}
        onChangeText={props.onChangeText}
        placeholderTextColor={palette.faint}
        scrollEnabled={props.multiline}
        style={{
          minHeight: props.multiline ? 150 : 46,
          borderWidth: 1,
          borderColor: palette.line,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          color: palette.text,
          fontSize: 13,
          lineHeight: 19,
          textAlignVertical: props.multiline ? 'top' : 'center',
          backgroundColor: palette.canvasRaised,
        }}
        value={props.value}
      />
    </View>
  );
}

export function DeliveryButton(props: {
  label: string;
  icon: typeof Check;
  disabled: boolean;
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const Icon = props.busy ? LoaderCircle : props.icon;
  const foreground = props.danger
    ? palette.danger
    : props.secondary
      ? palette.textSoft
      : palette.accentStrong;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: props.danger
          ? '#714047'
          : props.secondary
            ? palette.line
            : palette.accentLine,
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        opacity: props.disabled ? 0.42 : pressed ? 0.72 : 1,
        backgroundColor: props.secondary
          ? 'transparent'
          : palette.accentSurfaceStrong,
      })}
    >
      {props.busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Icon color={foreground} size={17} strokeWidth={1.9} />
      )}
      <Text
        selectable
        style={{ color: foreground, fontSize: 12, fontWeight: '700' }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function humanStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

export function shortRevision(value: string): string {
  return value.slice(0, 10);
}

export function formatBytes(value: number): string {
  if (value < 1_000) return `${String(value)} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}
