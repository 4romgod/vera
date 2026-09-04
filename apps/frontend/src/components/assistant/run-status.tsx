import { AlertCircle, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { type TaskResource } from '@vera/client';
import { ApprovalCard } from '@/components/approval-card';
import { GoalProgressCard } from '@/components/assistant/goal-progress-card';
import { palette, radius, shadow, spacing } from '@/design/tokens';

export function RunFooter(props: {
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
      <View style={{ gap: spacing.md }}>
        {run.goal === undefined ? null : (
          <GoalProgressCard goal={run.goal} compact />
        )}
        <ApprovalCard
          approval={run.approval}
          busy={props.busy}
          onDecision={props.onDecision}
        />
      </View>
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
      <View style={{ gap: spacing.md }}>
        {run.goal === undefined ? null : (
          <GoalProgressCard goal={run.goal} compact />
        )}
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
              style={{
                color: palette.danger,
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return null;
}

export function ErrorToast(props: {
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

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
