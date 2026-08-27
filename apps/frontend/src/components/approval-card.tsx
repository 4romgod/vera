import { Check, Paperclip, ShieldCheck, X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { TaskResource } from '@vera/client';

import { StructuredValue } from '@/components/structured-value';
import { palette, radius, spacing } from '@/design/tokens';
import { humanizeIdentifier } from '@/components/assistant/presentation';

type Approval = NonNullable<TaskResource['approval']>;

export function ApprovalCard(props: {
  approval: Approval;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => void;
}) {
  const effects = props.approval.authority?.sideEffects ?? [];
  return (
    <View
      style={{
        gap: spacing.lg,
        borderWidth: 1,
        borderColor: palette.accentLine,
        borderCurve: 'continuous',
        borderRadius: radius.lg,
        padding: spacing.lg,
        backgroundColor: palette.accentSurface,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.md,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            backgroundColor: palette.accentSurfaceStrong,
          }}
        >
          <ShieldCheck color={palette.accent} size={21} strokeWidth={1.9} />
        </View>
        <View style={{ minWidth: 0, flex: 1, gap: 4 }}>
          <Text
            selectable
            style={{
              color: palette.accent,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 0.8,
            }}
          >
            YOUR APPROVAL IS REQUIRED
          </Text>
          <Text
            selectable
            style={{ color: palette.text, fontSize: 20, fontWeight: '700' }}
          >
            {humanizeIdentifier(props.approval.capability.name)}
          </Text>
          <Text
            selectable
            style={{ color: palette.textSoft, fontSize: 13, lineHeight: 20 }}
          >
            Review what Vera wants to do. Approval applies only to this exact
            action.
          </Text>
        </View>
      </View>

      {props.approval.attachments === undefined ? null : (
        <View
          style={{
            gap: spacing.sm,
            borderWidth: 1,
            borderColor: palette.lineSoft,
            borderRadius: radius.md,
            padding: spacing.md,
            backgroundColor: palette.canvas,
          }}
        >
          <Text
            style={{
              color: palette.muted,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 0.8,
            }}
          >
            EXACT ATTACHMENTS
          </Text>
          {props.approval.attachments.map((attachment) => (
            <View
              key={attachment.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Paperclip color={palette.accent} size={15} />
              <View style={{ minWidth: 0, flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: palette.textSoft,
                    fontSize: 13,
                    fontWeight: '600',
                  }}
                >
                  {attachment.filename}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: palette.faint, fontSize: 10 }}
                >
                  {attachment.mediaType} ·{' '}
                  {String(Math.ceil(attachment.byteLength / 1024))} KB ·{' '}
                  {attachment.sha256.slice(0, 12)}…
                </Text>
              </View>
            </View>
          ))}
          {effects.includes('third_party_disclosure') ? (
            <Text style={{ color: '#F4C86A', fontSize: 12, lineHeight: 18 }}>
              Approval sends the selected document text and normalized images to
              the named third-party model provider.
            </Text>
          ) : (
            <Text
              style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}
            >
              Selected document text and normalized images stay within your
              owner-controlled model boundary.
            </Text>
          )}
        </View>
      )}

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.md,
          borderWidth: 1,
          borderColor: palette.lineSoft,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: palette.canvasRaised,
        }}
      >
        <Fact
          label="Destination"
          value={humanizeIdentifier(
            props.approval.destination?.adapterId ?? 'local',
          )}
        />
        <Fact
          label="Network"
          value={props.approval.authority?.networkAccess ?? 'none'}
        />
        <Fact
          label="Effects"
          value={
            effects.length === 0
              ? 'Read only'
              : effects.map(humanizeIdentifier).join(', ')
          }
        />
      </View>

      <View
        style={{
          gap: spacing.md,
          borderWidth: 1,
          borderColor: palette.lineSoft,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: palette.canvas,
        }}
      >
        <Text
          selectable
          style={{
            color: palette.muted,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.8,
          }}
        >
          EXACT ARGUMENTS
        </Text>
        <StructuredValue value={props.approval.proposedArguments} />
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          gap: spacing.sm,
        }}
      >
        <ActionButton
          disabled={props.busy}
          label="Reject"
          icon={X}
          secondary
          onPress={() => props.onDecision('rejected')}
        />
        <ActionButton
          disabled={props.busy}
          label="Approve exact action"
          icon={Check}
          onPress={() => props.onDecision('approved')}
        />
      </View>
    </View>
  );
}

function Fact(props: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 112, flexGrow: 1, gap: 4 }}>
      <Text
        selectable
        style={{
          color: palette.faint,
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.7,
        }}
      >
        {props.label.toUpperCase()}
      </Text>
      <Text selectable style={{ color: palette.textSoft, fontSize: 12 }}>
        {props.value}
      </Text>
    </View>
  );
}

function ActionButton(props: {
  label: string;
  icon: typeof Check;
  disabled: boolean;
  secondary?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        borderWidth: 1,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderColor: props.secondary ? palette.line : palette.accent,
        borderCurve: 'continuous',
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
        backgroundColor: props.secondary
          ? 'transparent'
          : palette.accentSurfaceStrong,
      })}
    >
      <Icon
        color={props.secondary ? palette.textSoft : palette.accentStrong}
        size={17}
        strokeWidth={1.9}
      />
      <Text
        selectable
        style={{
          color: props.secondary ? palette.textSoft : palette.text,
          fontWeight: '600',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
