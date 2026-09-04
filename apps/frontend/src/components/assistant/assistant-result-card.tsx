import { useEffect, useState, type ReactNode } from 'react';
import {
  BellRing,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileCode2,
  FileSearch,
  Flag,
  Search,
  ServerCog,
  Wrench,
  Library,
} from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { ArtifactResource, TaskResource, VeraApi } from '@vera/client';

import { StructuredValue } from '@/components/structured-value';
import { palette, radius, spacing } from '@/design/tokens';
import { humanizeIdentifier } from './presentation';
import { GoalProgressCard } from './goal-progress-card';
import { SoftwareDeliveryCard } from './software-delivery/software-delivery-card';
import { softwareChangeArtifactReference } from './software-delivery/model';

export function hasStructuredResult(
  task: TaskResource | null | undefined,
): boolean {
  return task?.output !== undefined && task.output.kind !== 'response';
}

export function AssistantResultCard(props: {
  task: TaskResource;
  client: VeraApi;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const attachmentEvidence = useAttachmentEvidence(props.task, props.client);
  const output = props.task.output;
  if (output === undefined || output.kind === 'response') return null;

  const presentation = resultPresentation(output);
  const softwareChange = softwareChangeArtifactReference(props.task);
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
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            backgroundColor: palette.accentSurface,
          }}
        >
          <presentation.icon
            color={palette.accent}
            size={19}
            strokeWidth={1.9}
          />
        </View>
        <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
          <Text
            selectable
            style={{ color: palette.text, fontSize: 16, fontWeight: '700' }}
          >
            {presentation.title}
          </Text>
          {presentation.summary === undefined ? null : (
            <Text
              selectable
              style={{ color: palette.textSoft, fontSize: 13, lineHeight: 19 }}
            >
              {presentation.summary}
            </Text>
          )}
        </View>
      </View>

      {output.kind !== 'adaptive_goal_result' ||
      props.task.goal === undefined ? null : (
        <GoalProgressCard goal={props.task.goal} />
      )}

      {attachmentEvidence.artifacts.map((artifact) => (
        <AttachmentEvidence key={artifact.id} analysis={artifact.content} />
      ))}

      {attachmentEvidence.failed ? (
        <Text
          accessibilityRole="alert"
          selectable
          style={{ color: palette.warning, fontSize: 12, lineHeight: 18 }}
        >
          Vera could not reload the evidence details. The immutable artifact
          references remain available in Technical details.
        </Text>
      ) : null}

      {softwareChange === undefined ? (
        presentation.content
      ) : (
        <SoftwareDeliveryCard
          artifactId={softwareChange.id}
          client={props.client}
          preview={
            output.kind === 'software_change' ? output.change : undefined
          }
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={() => setDetailsOpen((value) => !value)}
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
        <Text style={{ color: palette.muted, fontSize: 12 }}>
          Technical details
        </Text>
        {detailsOpen ? (
          <ChevronUp color={palette.muted} size={16} />
        ) : (
          <ChevronDown color={palette.muted} size={16} />
        )}
      </Pressable>
      {detailsOpen ? (
        <View
          style={{
            borderRadius: radius.md,
            padding: spacing.md,
            backgroundColor: palette.canvas,
          }}
        >
          <StructuredValue
            value={{
              taskId: props.task.taskId,
              runId: props.task.runId,
              output,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function useAttachmentEvidence(
  task: TaskResource,
  client: VeraApi,
): {
  artifacts: Extract<ArtifactResource, { type: 'attachment_analysis' }>[];
  failed: boolean;
} {
  const [state, setState] = useState<{
    artifacts: Extract<ArtifactResource, { type: 'attachment_analysis' }>[];
    failed: boolean;
  }>({ artifacts: [], failed: false });
  const references =
    task.output?.kind === 'adaptive_goal_result'
      ? task.output.evidence.filter(
          (reference) => reference.type === 'attachment_analysis',
        )
      : [];
  const identity = references.map(({ id, sha256 }) => `${id}:${sha256}`).join();

  useEffect(() => {
    const artifactIds = identity
      .split(',')
      .filter((value) => value.length > 0)
      .map((value) => value.slice(0, value.indexOf(':')));
    if (artifactIds.length === 0) {
      setState({ artifacts: [], failed: false });
      return;
    }
    setState({ artifacts: [], failed: false });
    const controller = new AbortController();
    void Promise.all(
      artifactIds.map((artifactId) =>
        client.getArtifact(artifactId, { signal: controller.signal }),
      ),
    )
      .then((loaded) => {
        const analyses = loaded.filter(
          (
            artifact,
          ): artifact is Extract<
            ArtifactResource,
            { type: 'attachment_analysis' }
          > => artifact.type === 'attachment_analysis',
        );
        if (!controller.signal.aborted) {
          setState({ artifacts: analyses, failed: false });
        }
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted &&
          (!(cause instanceof DOMException) || cause.name !== 'AbortError')
        ) {
          setState({ artifacts: [], failed: true });
        }
      });
    return () => controller.abort();
  }, [client, identity]);

  return state;
}

function AttachmentEvidence(props: {
  analysis: Extract<
    ArtifactResource,
    { type: 'attachment_analysis' }
  >['content'];
}) {
  return (
    <View
      style={{
        gap: spacing.md,
        borderLeftWidth: 2,
        borderLeftColor: palette.accentLine,
        paddingLeft: spacing.md,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: palette.accent,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.8,
          }}
        >
          UNDERSTOOD FROM YOUR FILES
        </Text>
        <Text selectable style={{ color: palette.textSoft, lineHeight: 20 }}>
          {props.analysis.summary}
        </Text>
      </View>
      {props.analysis.citations.map((citation, index) => (
        <View
          key={`${citation.attachmentId}-${citation.kind === 'document' ? citation.locator : 'image'}-${String(index)}`}
          style={{ gap: 3 }}
        >
          <Text
            style={{ color: palette.accent, fontSize: 11, fontWeight: '700' }}
          >
            {citation.kind === 'document'
              ? `${citation.filename} · ${citation.locator}`
              : `${citation.filename} · image`}
          </Text>
          {citation.kind === 'document' ? (
            <Text
              selectable
              style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}
            >
              “{citation.excerpt}”
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function resultPresentation(output: NonNullable<TaskResource['output']>): {
  title: string;
  summary?: string;
  icon: typeof Brain;
  content?: ReactNode;
} {
  switch (output.kind) {
    case 'machine_diagnostic':
      return {
        title: output.diagnostic?.machine.displayName ?? 'Machine inspected',
        summary:
          output.diagnostic === undefined
            ? undefined
            : `Checked ${String(output.diagnostic.diagnostics.length)} system diagnostic${output.diagnostic.diagnostics.length === 1 ? '' : 's'} and ${String(output.diagnostic.services.length)} registered service${output.diagnostic.services.length === 1 ? '' : 's'}.`,
        icon: ServerCog,
        content:
          output.diagnostic === undefined ? undefined : (
            <View style={{ gap: spacing.sm }}>
              <Text selectable style={{ color: palette.muted, fontSize: 11 }}>
                {output.diagnostic.system.hostname} ·{' '}
                {output.diagnostic.system.platform} ·{' '}
                {output.diagnostic.system.architecture}
              </Text>
              {output.diagnostic.diagnostics.map((diagnostic) => (
                <ResultRow
                  key={`diagnostic-${diagnostic.id}`}
                  status={diagnostic.observation.status}
                  title={diagnostic.label}
                  detail={diagnostic.observation.summary}
                />
              ))}
              {output.diagnostic.services.map((service) => (
                <ResultRow
                  key={`service-${service.id}`}
                  status={service.observation.status}
                  title={service.displayName}
                  detail={service.observation.summary}
                />
              ))}
            </View>
          ),
      };
    case 'machine_service_action_result':
      return {
        title:
          output.result === undefined
            ? 'Machine action completed'
            : `${humanizeIdentifier(output.result.action)} ${output.result.service.displayName}`,
        summary:
          output.result === undefined
            ? undefined
            : `${output.result.machine.displayName} · ${output.result.verified ? 'Postcondition verified' : 'Verification failed'}`,
        icon: Wrench,
        content:
          output.result === undefined ? undefined : (
            <View style={{ gap: spacing.sm }}>
              <ResultRow
                status={output.result.before.status}
                title="Before"
                detail={output.result.before.summary}
              />
              <ResultRow
                status={output.result.after.status}
                title="After"
                detail={output.result.after.summary}
              />
            </View>
          ),
      };
    case 'personal_task_result':
      return {
        title: humanizeIdentifier(`${output.result?.action ?? 'task'} task`),
        summary: output.result?.summary,
        icon: ClipboardCheck,
        content: output.result?.tasks.map((task) => (
          <ResultRow
            key={task.id}
            status={task.status}
            title={task.title}
            detail={
              task.dueAt === undefined ? undefined : formatDate(task.dueAt)
            }
          />
        )),
      };
    case 'personal_reminder_result':
      return {
        title: humanizeIdentifier(
          `${output.result?.action ?? 'reminder'} reminder`,
        ),
        summary: output.result?.summary,
        icon: BellRing,
        content: output.result?.reminders.map((reminder) => (
          <ResultRow
            key={reminder.id}
            status={reminder.status}
            title={reminder.message}
            detail={formatDate(reminder.scheduledFor)}
          />
        )),
      };
    case 'memory_result':
      return {
        title: humanizeIdentifier(
          `${output.result?.action ?? 'memory'} memory`,
        ),
        summary: output.result?.summary,
        icon: Brain,
        content: output.result?.memories.map((memory) => (
          <ResultRow
            key={memory.id}
            status={humanizeIdentifier(memory.kind)}
            title={memory.subject}
            detail={memory.content}
          />
        )),
      };
    case 'knowledge_result':
      return {
        title:
          output.result?.action === 'search'
            ? 'Answer from your knowledge'
            : 'Knowledge library updated',
        summary: output.result?.summary,
        icon: Library,
        content:
          output.result === undefined ? undefined : (
            <View style={{ gap: spacing.md }}>
              {output.result.answer === undefined ? null : (
                <Text
                  selectable
                  style={{
                    color: palette.textSoft,
                    fontSize: 15,
                    lineHeight: 22,
                  }}
                >
                  {output.result.answer}
                </Text>
              )}
              {(output.result.citations ?? []).map((citation, index) => (
                <View
                  key={citation.chunkId}
                  style={{
                    gap: 4,
                    borderLeftWidth: 2,
                    borderLeftColor: palette.accentLine,
                    paddingLeft: spacing.md,
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: palette.accent,
                      fontSize: 11,
                      fontWeight: '700',
                    }}
                  >
                    [{String(index + 1)}] {citation.sourceTitle}
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
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    “{citation.excerpt}”
                  </Text>
                </View>
              ))}
              {output.result.answer === undefined
                ? output.result.sources.map((source) => (
                    <ResultRow
                      detail={source.provenance.attachments
                        .map(({ filename }) => filename)
                        .join(', ')}
                      key={source.id}
                      status={source.status}
                      title={source.title}
                    />
                  ))
                : null}
              {(output.result.limitations ?? []).map((limitation) => (
                <Text
                  key={limitation}
                  selectable
                  style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}
                >
                  Limitation: {limitation}
                </Text>
              ))}
            </View>
          ),
      };
    case 'attention_result':
      return {
        title: output.result?.briefing.headline ?? 'Your briefing',
        summary: output.result?.briefing.summary,
        icon: BellRing,
        content: output.result?.briefing.items.map((item) => (
          <ResultRow
            detail={item.summary}
            key={item.id}
            status={humanizeIdentifier(item.priority)}
            title={item.title}
          />
        )),
      };
    case 'research_report':
      return {
        title: 'Research complete',
        summary: output.report?.objective,
        icon: Search,
        content:
          output.report === undefined ? undefined : (
            <View style={{ gap: spacing.md }}>
              <Text
                selectable
                style={{ color: palette.textSoft, lineHeight: 21 }}
              >
                {output.report.report}
              </Text>
              {output.report.sources.length === 0 ? null : (
                <View style={{ gap: spacing.sm }}>
                  <Text
                    selectable
                    style={{
                      color: palette.faint,
                      fontSize: 10,
                      fontWeight: '700',
                      letterSpacing: 0.8,
                    }}
                  >
                    SOURCES
                  </Text>
                  {output.report.sources.map((source) => (
                    <Text
                      key={source.url}
                      selectable
                      style={{ color: palette.accent, fontSize: 12 }}
                    >
                      {source.title}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ),
      };
    case 'attachment_analysis':
      return {
        title: 'Attachment analysis complete',
        summary: output.analysis?.summary,
        icon: FileSearch,
        content:
          output.analysis === undefined ? undefined : (
            <View style={{ gap: spacing.md }}>
              {output.analysis.findings.map((finding, index) => (
                <Text
                  key={`${String(index)}-${finding}`}
                  selectable
                  style={{
                    color: palette.textSoft,
                    fontSize: 14,
                    lineHeight: 21,
                  }}
                >
                  {`• ${finding}`}
                </Text>
              ))}
              <View style={{ gap: spacing.sm }}>
                <Text
                  style={{
                    color: palette.faint,
                    fontSize: 10,
                    fontWeight: '700',
                    letterSpacing: 0.8,
                  }}
                >
                  EVIDENCE
                </Text>
                {output.analysis.citations.map((citation, index) => (
                  <View
                    key={`${citation.attachmentId}-${citation.kind === 'document' ? citation.locator : 'image'}-${String(index)}`}
                    style={{
                      gap: 4,
                      borderLeftWidth: 2,
                      borderLeftColor: palette.accentLine,
                      paddingLeft: spacing.sm,
                    }}
                  >
                    <Text
                      style={{
                        color: palette.accent,
                        fontSize: 11,
                        fontWeight: '700',
                      }}
                    >
                      {citation.kind === 'document'
                        ? `${citation.filename} · ${citation.locator}`
                        : `${citation.filename} · image`}
                    </Text>
                    {citation.kind === 'document' ? (
                      <Text
                        selectable
                        style={{
                          color: palette.muted,
                          fontSize: 12,
                          lineHeight: 18,
                        }}
                      >
                        “{citation.excerpt}”
                      </Text>
                    ) : (
                      <Text
                        style={{
                          color: palette.muted,
                          fontSize: 12,
                          lineHeight: 18,
                        }}
                      >
                        Visual evidence from the approved image.
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          ),
      };
    case 'development_plan':
      return {
        title: 'Development plan ready',
        summary: 'Vera prepared a bounded implementation plan.',
        icon: CheckCircle2,
      };
    case 'software_change':
      return {
        title: 'Software change ready',
        summary: 'The proposed change is available for review.',
        icon: FileCode2,
      };
    case 'goal_result':
      return { title: 'Goal completed', summary: output.summary, icon: Flag };
    case 'adaptive_goal_result':
      return { title: 'Goal completed', summary: output.message, icon: Flag };
    default:
      return { title: 'Work completed', icon: CheckCircle2 };
  }
}

function ResultRow(props: { title: string; status: string; detail?: string }) {
  return (
    <View
      style={{
        gap: 4,
        borderTopWidth: 1,
        borderTopColor: palette.lineSoft,
        paddingTop: spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
        }}
      >
        <Text
          selectable
          style={{
            minWidth: 0,
            flex: 1,
            color: palette.text,
            fontSize: 14,
            fontWeight: '600',
          }}
        >
          {props.title}
        </Text>
        <Text
          selectable
          style={{
            borderRadius: radius.pill,
            paddingHorizontal: 8,
            paddingVertical: 3,
            color: palette.accentStrong,
            fontSize: 9,
            fontWeight: '700',
            textTransform: 'uppercase',
            backgroundColor: palette.accentSurface,
          }}
        >
          {props.status}
        </Text>
      </View>
      {props.detail === undefined ? null : (
        <Text
          selectable
          style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}
        >
          {props.detail}
        </Text>
      )}
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
