import { type ReactNode } from 'react';
import { Brain, Check, ExternalLink } from 'lucide-react-native';
import { Linking, Pressable, Text, View } from 'react-native';
import type {
  DevelopmentCampaignResource,
  MissionResource,
} from '@vera/client';
import { palette, radius, spacing } from '@/design/tokens';
import { humanizeIdentifier } from '../assistant/presentation.ts';
import { isSafeGitHubPullRequestUrl } from '../assistant/software-delivery/model.ts';

export function CampaignCard(props: {
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

export function MissionCard(props: {
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

export function ResourceCard(props: { children: ReactNode }) {
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

export function Tag(props: { label: string }) {
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

export function SmallButton(props: {
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

export function Empty(props: {
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

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
