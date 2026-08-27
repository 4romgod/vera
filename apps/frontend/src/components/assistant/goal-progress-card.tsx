import {
  Check,
  Circle,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { Text, View } from 'react-native';

import type { TaskResource } from '@vera/client';

import { palette, radius, spacing } from '@/design/tokens';
import { goalProgressStages, humanizeIdentifier } from './presentation';

type Goal = NonNullable<TaskResource['goal']>;
type Step = Goal['steps'][number];

export function GoalProgressCard(props: { goal: Goal; compact?: boolean }) {
  const stages = goalProgressStages(props.goal);
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: spacing.md,
        borderWidth: 1,
        borderColor: palette.lineSoft,
        borderRadius: radius.lg,
        padding: props.compact ? spacing.md : spacing.lg,
        backgroundColor: palette.surface,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text
          selectable
          style={{
            color: palette.accent,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.8,
          }}
        >
          VERA IS WORKING
        </Text>
        <Text
          selectable
          style={{ color: palette.text, fontSize: 16, fontWeight: '700' }}
        >
          {props.goal.summary}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {stages.map((stage, index) => (
          <View
            key={stage.label}
            style={{ minWidth: 0, flex: 1, flexDirection: 'row' }}
          >
            <View style={{ minWidth: 0, flex: 1, gap: 7 }}>
              <View
                style={{
                  height: 5,
                  borderRadius: radius.pill,
                  backgroundColor:
                    stage.state === 'done'
                      ? palette.accent
                      : stage.state === 'active'
                        ? palette.accentStrong
                        : palette.line,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  color:
                    stage.state === 'pending'
                      ? palette.faint
                      : palette.textSoft,
                  fontSize: 11,
                  fontWeight: stage.state === 'active' ? '700' : '500',
                }}
              >
                {stage.label}
              </Text>
            </View>
            {index === stages.length - 1 ? null : (
              <View style={{ width: spacing.sm }} />
            )}
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        {props.goal.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </View>
    </View>
  );
}

function StepRow(props: { step: Step }) {
  const presentation = stepPresentation(props.step);
  const Icon = presentation.icon;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        borderRadius: radius.md,
        padding: spacing.sm,
        backgroundColor:
          presentation.state === 'active'
            ? palette.accentSurface
            : palette.canvas,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor:
            presentation.state === 'active'
              ? palette.accentSurfaceStrong
              : palette.surface,
        }}
      >
        <Icon color={presentation.color} size={15} strokeWidth={2} />
      </View>
      <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
        <Text
          selectable
          style={{ color: palette.text, fontSize: 13, fontWeight: '600' }}
        >
          {humanizeIdentifier(props.step.capability)}
        </Text>
        <Text
          selectable
          style={{ color: palette.muted, fontSize: 11, lineHeight: 16 }}
        >
          {props.step.purpose}
        </Text>
      </View>
      <Text
        style={{
          color: presentation.color,
          fontSize: 9,
          fontWeight: '700',
          textTransform: 'uppercase',
        }}
      >
        {presentation.label}
      </Text>
    </View>
  );
}

function stepPresentation(step: Step): {
  state: 'active' | 'done' | 'pending' | 'failed';
  label: string;
  icon: typeof Circle;
  color: string;
} {
  if (step.status === 'succeeded') {
    return {
      state: 'done',
      label: 'Done',
      icon: Check,
      color: palette.accent,
    };
  }
  if (['failed', 'rejected', 'cancelled'].includes(step.status)) {
    return {
      state: 'failed',
      label: humanizeIdentifier(step.status),
      icon: X,
      color: palette.danger,
    };
  }
  if (step.status === 'awaiting_approval') {
    return {
      state: 'active',
      label: 'Approval',
      icon: ShieldCheck,
      color: palette.accentStrong,
    };
  }
  if (step.status === 'executing') {
    return {
      state: 'active',
      label: 'Working',
      icon: LoaderCircle,
      color: palette.accentStrong,
    };
  }
  return {
    state: 'pending',
    label: 'Next',
    icon: Circle,
    color: palette.faint,
  };
}
