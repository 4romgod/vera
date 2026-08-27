import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Rocket,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { Linking, Pressable, Switch, Text, View } from 'react-native';

import type {
  SoftwareChangeContent,
  SoftwareChangePublicationResource,
  VeraApi,
} from '@vera/client';

import { StructuredValue } from '@/components/structured-value';
import {
  ApprovalSection,
  DeliveryButton,
  Fact,
  Field,
  InlineNotice,
  LoadingRow,
  SectionHeading,
  StagePrompt,
  StatusPill,
  SuccessNotice,
  TerminalNotice,
  formatBytes,
  humanStatus,
  shortRevision,
} from './delivery-controls';
import { palette, radius, spacing } from '@/design/tokens';
import {
  isSafeGitHubPullRequestUrl,
  publicationDraftForArtifact,
  type PublicationDraft,
} from './model';
import { useSoftwareDelivery } from './use-software-delivery';

export function SoftwareDeliveryCard(props: {
  artifactId: string;
  client: VeraApi;
  preview?: SoftwareChangeContent;
}) {
  const delivery = useSoftwareDelivery(props.client, props.artifactId);
  const { artifact, application, publication } = delivery.state;
  const [manifestOpen, setManifestOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [publicationFormOpen, setPublicationFormOpen] = useState(false);
  const [publicationDraft, setPublicationDraft] = useState<PublicationDraft>();
  const initializedArtifact = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (artifact !== undefined && initializedArtifact.current !== artifact.id) {
      initializedArtifact.current = artifact.id;
      setPublicationDraft(publicationDraftForArtifact(artifact));
    }
  }, [artifact]);

  const change = artifact?.content ?? props.preview;
  const phase =
    publication?.status === 'succeeded'
      ? 3
      : publication !== undefined
        ? 2
        : application?.status === 'succeeded'
          ? 2
          : application !== undefined
            ? 1
            : 0;
  const busy = delivery.state.busy !== undefined;

  return (
    <View style={{ gap: spacing.lg }}>
      <DeliveryProgress phase={phase} />

      {change === undefined ? (
        <LoadingRow label="Loading the exact software-change artifact…" />
      ) : (
        <ChangeSummary
          change={change}
          manifestOpen={manifestOpen}
          onToggleManifest={() => setManifestOpen((current) => !current)}
        />
      )}

      {delivery.state.error === undefined ? null : (
        <InlineNotice
          danger
          message={delivery.state.error}
          action="Try again"
          onAction={() => void delivery.refresh()}
        />
      )}

      {artifact === undefined ? null : (
        <ApplicationStage
          application={application}
          busy={busy}
          onCancel={() => void delivery.cancelApplication()}
          onDecision={(decision) => void delivery.decideApplication(decision)}
          onPrepare={() => void delivery.prepareApplication()}
        />
      )}

      {application?.status === 'succeeded' ? (
        <PublicationStage
          busy={busy}
          draft={publicationDraft}
          formOpen={publicationFormOpen}
          publication={publication}
          onChangeDraft={setPublicationDraft}
          onCancel={() => void delivery.cancelPublication()}
          onDecision={(decision) => void delivery.decidePublication(decision)}
          onOpenForm={() => setPublicationFormOpen(true)}
          onPrepare={(draft) => void delivery.preparePublication(draft)}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: technicalOpen }}
        onPress={() => setTechnicalOpen((current) => !current)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTopWidth: 1,
          borderTopColor: palette.lineSoft,
          paddingTop: spacing.md,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text selectable style={{ color: palette.muted, fontSize: 12 }}>
          Delivery evidence
        </Text>
        {technicalOpen ? (
          <ChevronUp color={palette.muted} size={16} />
        ) : (
          <ChevronDown color={palette.muted} size={16} />
        )}
      </Pressable>
      {technicalOpen ? (
        <View
          style={{
            borderRadius: radius.md,
            padding: spacing.md,
            backgroundColor: palette.canvas,
          }}
        >
          <StructuredValue
            value={{
              artifact,
              application,
              publication,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function DeliveryProgress(props: { phase: number }) {
  const steps = ['Change', 'Staged', 'Pull request'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {steps.map((step, index) => {
        const reached = props.phase >= index + 1;
        const active = props.phase === index;
        return (
          <View
            key={step}
            style={{
              minWidth: 0,
              flex: index === steps.length - 1 ? 0 : 1,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{ alignItems: 'center', gap: 5 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor:
                    reached || active ? palette.accent : palette.line,
                  borderRadius: radius.pill,
                  backgroundColor: reached
                    ? palette.accentSurfaceStrong
                    : palette.canvasRaised,
                }}
              >
                {reached ? (
                  <Check color={palette.accentStrong} size={13} />
                ) : (
                  <Text
                    style={{
                      color: active ? palette.accent : palette.faint,
                      fontSize: 10,
                      fontWeight: '700',
                    }}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                selectable
                style={{
                  color: reached || active ? palette.textSoft : palette.faint,
                  fontSize: 9,
                  fontWeight: '700',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                {step}
              </Text>
            </View>
            {index === steps.length - 1 ? null : (
              <View
                style={{
                  height: 1,
                  flex: 1,
                  marginHorizontal: spacing.sm,
                  marginBottom: 18,
                  backgroundColor:
                    props.phase > index + 1 ? palette.accentLine : palette.line,
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function ChangeSummary(props: {
  change: SoftwareChangeContent;
  manifestOpen: boolean;
  onToggleManifest: () => void;
}) {
  const visibleFiles = props.manifestOpen
    ? props.change.files
    : props.change.files.slice(0, 6);
  return (
    <View style={{ gap: spacing.md }}>
      <Text
        selectable
        style={{ color: palette.textSoft, fontSize: 14, lineHeight: 21 }}
      >
        {props.change.summary}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Fact label="Project" value={props.change.project.name} />
        <Fact label="Ticket" value={props.change.ticket.reference} />
        <Fact label="Files" value={String(props.change.files.length)} numeric />
      </View>
      <View
        style={{
          gap: spacing.sm,
          borderWidth: 1,
          borderColor: palette.lineSoft,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: palette.canvasRaised,
        }}
      >
        {visibleFiles.map((file) => (
          <View
            key={file.relativePath}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <StatusPill label={file.operation} />
            <Text
              selectable
              numberOfLines={1}
              style={{
                minWidth: 0,
                flex: 1,
                color: palette.textSoft,
                fontSize: 12,
              }}
            >
              {file.relativePath}
            </Text>
            <Text
              selectable
              style={{
                color: palette.faint,
                fontSize: 10,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatBytes(file.bytes)}
            </Text>
          </View>
        ))}
        {props.change.files.length <= 6 ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={props.onToggleManifest}
            style={({ pressed }) => ({
              minHeight: 38,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text
              style={{ color: palette.accent, fontSize: 11, fontWeight: '600' }}
            >
              {props.manifestOpen
                ? 'Show fewer files'
                : `Show all ${String(props.change.files.length)} files`}
            </Text>
          </Pressable>
        )}
      </View>
      {props.change.risks.length === 0 ? null : (
        <View style={{ gap: spacing.sm }}>
          <Text
            selectable
            style={{
              color: palette.warning,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 0.7,
            }}
          >
            REPORTED RISKS
          </Text>
          {props.change.risks.map((risk) => (
            <Text
              key={risk}
              selectable
              style={{ color: palette.textSoft, fontSize: 12, lineHeight: 18 }}
            >
              • {risk}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function ApplicationStage(props: {
  application?: ReturnType<typeof useSoftwareDelivery>['state']['application'];
  busy: boolean;
  onPrepare: () => void;
  onDecision: (decision: 'approved' | 'rejected') => void;
  onCancel: () => void;
}) {
  const application = props.application;
  if (application === undefined) {
    return (
      <StagePrompt
        icon={GitBranch}
        title="Prepare a safe staging review"
        message="Vera will create an isolated managed worktree and freeze the exact patch, branch, and file manifest. Nothing is committed or pushed."
        action="Prepare staging review"
        busy={props.busy}
        onPress={props.onPrepare}
      />
    );
  }
  if (
    application.status === 'approved' ||
    application.status === 'applying' ||
    application.status === 'cancellation_requested'
  ) {
    return (
      <View style={{ gap: spacing.md }}>
        <LoadingRow label={`Vera is ${humanStatus(application.status)}…`} />
        {application.links.cancellation === undefined ? null : (
          <DeliveryButton
            label="Cancel staging"
            secondary
            danger
            disabled={props.busy}
            icon={X}
            onPress={props.onCancel}
          />
        )}
      </View>
    );
  }
  if (
    application.status === 'awaiting_approval' &&
    application.approval.status === 'pending'
  ) {
    const effect = application.approval.effect;
    return (
      <ApprovalSection
        eyebrow="STAGING APPROVAL"
        title="Apply this exact patch?"
        message="Approval writes only these files into Vera’s isolated worktree and stages them on the disclosed branch. It does not commit or contact GitHub."
        facts={[
          ['Project', application.project.displayName],
          ['Branch', effect.branchName],
          ['Base', shortRevision(effect.baseRevision)],
          ['Files', String(effect.files.length)],
        ]}
        exact={effect}
        busy={props.busy}
        onDecision={props.onDecision}
      />
    );
  }
  if (application.status === 'succeeded') {
    return (
      <SuccessNotice
        title="Change staged"
        message={`${String(application.result?.files.length ?? 0)} files are staged on ${application.result?.branchName ?? application.approval.effect.branchName}. No commit or remote write has happened.`}
      />
    );
  }
  return (
    <TerminalNotice
      status={application.status}
      failure={application.failure?.message}
      retryLabel="Prepare a new staging review"
      busy={props.busy}
      onRetry={props.onPrepare}
    />
  );
}

function PublicationStage(props: {
  publication?: SoftwareChangePublicationResource;
  draft?: PublicationDraft;
  formOpen: boolean;
  busy: boolean;
  onOpenForm: () => void;
  onChangeDraft: (draft: PublicationDraft) => void;
  onPrepare: (draft: PublicationDraft) => void;
  onDecision: (decision: 'approved' | 'rejected') => void;
  onCancel: () => void;
}) {
  const publication = props.publication;
  if (publication === undefined) {
    if (!props.formOpen) {
      return (
        <StagePrompt
          icon={Rocket}
          title="Turn the staged change into a pull request"
          message="Set the commit and pull-request details. Vera will validate GitHub and freeze the exact remote effect before asking for separate approval."
          action="Configure pull request"
          busy={props.busy}
          onPress={props.onOpenForm}
        />
      );
    }
    return props.draft === undefined ? (
      <LoadingRow label="Preparing publication defaults…" />
    ) : (
      <PublicationForm
        busy={props.busy}
        draft={props.draft}
        onChange={props.onChangeDraft}
        onSubmit={props.onPrepare}
      />
    );
  }
  if (
    publication.status === 'approved' ||
    publication.status === 'publishing'
  ) {
    return (
      <View style={{ gap: spacing.md }}>
        <LoadingRow label={`Vera is ${humanStatus(publication.status)}…`} />
        {publication.links.cancellation === undefined ? null : (
          <DeliveryButton
            label="Cancel publication"
            secondary
            danger
            disabled={props.busy}
            icon={X}
            onPress={props.onCancel}
          />
        )}
      </View>
    );
  }
  if (
    publication.status === 'awaiting_approval' &&
    publication.approval.status === 'pending'
  ) {
    const effect = publication.approval.effect;
    return (
      <ApprovalSection
        eyebrow="PUBLICATION APPROVAL"
        title="Create this commit and pull request?"
        message="This approval creates or verifies one Vera branch and one pull request. Direct base pushes and force pushes are forbidden."
        facts={[
          [
            'Repository',
            `${effect.repository.owner}/${effect.repository.name}`,
          ],
          ['Base', effect.baseBranch],
          ['Head', effect.headBranch],
          ['Files', String(effect.files.length)],
          ['Commit', effect.commitMessage],
          ['PR', effect.pullRequest.title],
          ['Mode', effect.pullRequest.draft ? 'Draft' : 'Ready for review'],
        ]}
        exact={effect}
        busy={props.busy}
        onDecision={props.onDecision}
      />
    );
  }
  if (publication.status === 'succeeded' && publication.result !== undefined) {
    const url = publication.result.pullRequest.url;
    const safe = isSafeGitHubPullRequestUrl(url);
    return (
      <View style={{ gap: spacing.md }}>
        <SuccessNotice
          title={`Pull request #${String(publication.result.pullRequest.number)} is open`}
          message={`${publication.result.remoteBranch} was published at ${shortRevision(publication.result.commitRevision)}.`}
        />
        <DeliveryButton
          label="Open pull request"
          icon={ExternalLink}
          disabled={!safe}
          onPress={() => {
            if (safe) void Linking.openURL(url);
          }}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.lg }}>
      <TerminalNotice
        status={publication.status}
        failure={publication.failure?.message}
        retryLabel="Configure another pull request"
        busy={props.busy}
        onRetry={props.onOpenForm}
      />
      {!props.formOpen ? null : props.draft === undefined ? (
        <LoadingRow label="Preparing publication defaults…" />
      ) : (
        <PublicationForm
          busy={props.busy}
          draft={props.draft}
          onChange={props.onChangeDraft}
          onSubmit={props.onPrepare}
        />
      )}
    </View>
  );
}

function PublicationForm(props: {
  draft: PublicationDraft;
  busy: boolean;
  onChange: (draft: PublicationDraft) => void;
  onSubmit: (draft: PublicationDraft) => void;
}) {
  const valid =
    props.draft.baseBranch.trim().length > 0 &&
    props.draft.commitMessage.trim().length > 0 &&
    props.draft.pullRequestTitle.trim().length > 0;
  const update = (value: Partial<PublicationDraft>) =>
    props.onChange({ ...props.draft, ...value });
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
        icon={GitCommitHorizontal}
        eyebrow="PULL REQUEST SETUP"
        title="Define the proposed remote effect"
        message="These values remain editable until Vera prepares the review. Preparation does not publish anything."
      />
      <Field
        label="Base branch"
        value={props.draft.baseBranch}
        onChangeText={(baseBranch) => update({ baseBranch })}
      />
      <Field
        label="Commit message"
        value={props.draft.commitMessage}
        onChangeText={(commitMessage) => update({ commitMessage })}
      />
      <Field
        label="Pull request title"
        value={props.draft.pullRequestTitle}
        onChangeText={(pullRequestTitle) => update({ pullRequestTitle })}
      />
      <Field
        label="Pull request body"
        value={props.draft.pullRequestBody}
        multiline
        onChangeText={(pullRequestBody) => update({ pullRequestBody })}
      />
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
      >
        <Switch
          accessibilityLabel="Create as draft pull request"
          onValueChange={(draft) => update({ draft })}
          thumbColor={props.draft.draft ? palette.accentStrong : palette.muted}
          trackColor={{ false: palette.line, true: palette.accentLine }}
          value={props.draft.draft}
        />
        <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
          <Text
            selectable
            style={{ color: palette.text, fontSize: 13, fontWeight: '600' }}
          >
            Draft pull request
          </Text>
          <Text
            selectable
            style={{ color: palette.muted, fontSize: 11, lineHeight: 16 }}
          >
            Keep review explicitly incomplete on GitHub.
          </Text>
        </View>
      </View>
      <DeliveryButton
        label="Prepare exact publication review"
        icon={ShieldCheck}
        disabled={props.busy || !valid}
        busy={props.busy}
        onPress={() => props.onSubmit(props.draft)}
      />
    </View>
  );
}
