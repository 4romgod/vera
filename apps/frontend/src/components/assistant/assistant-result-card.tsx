import { useState, type ReactNode } from 'react';
import {
  BellRing,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileCode2,
  Flag,
  Search,
} from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { TaskResource } from '@vera/client';

import { StructuredValue } from '@/components/structured-value';
import { palette, radius, spacing } from '@/design/tokens';
import { humanizeIdentifier } from './presentation';

export function hasStructuredResult(
  task: TaskResource | null | undefined,
): boolean {
  return task?.output !== undefined && task.output.kind !== 'response';
}

export function AssistantResultCard(props: { task: TaskResource }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const output = props.task.output;
  if (output === undefined || output.kind === 'response') return null;

  const presentation = resultPresentation(output);
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

      {presentation.content}

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

function resultPresentation(output: NonNullable<TaskResource['output']>): {
  title: string;
  summary?: string;
  icon: typeof Brain;
  content?: ReactNode;
} {
  switch (output.kind) {
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
