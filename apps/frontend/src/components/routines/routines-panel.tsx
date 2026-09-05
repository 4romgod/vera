import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  Check,
  Clock3,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  GitPullRequest,
  X,
} from 'lucide-react-native';
import { Pressable, Text, TextInput, View } from 'react-native';

import type {
  MachineCatalogResource,
  ProjectResource,
  IntegrationConnectionResource,
  RoutineResource,
  RoutineRunResource,
} from '@vera/client';
import { palette, radius, spacing } from '@/design/tokens';

const DAYS = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
  { value: 0, label: 'S' },
];
const DAY_NAMES: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};
const SIGNAL_LABELS = {
  review_requested: 'review requests',
  mentioned: 'mentions',
  assigned: 'assignments',
  failed_check: 'failed checks',
} as const;

export function RoutinesPanel(props: {
  routines: RoutineResource[];
  runs: Partial<Record<string, RoutineRunResource[]>>;
  machines: MachineCatalogResource['machines'];
  projects: ProjectResource[];
  connections: IntegrationConnectionResource[];
  actionId?: string;
  onCreate: (input: {
    title: string;
    machineId: string;
    serviceIds?: string[];
    localTime: string;
    daysOfWeek: number[];
    timeZone: string;
  }) => Promise<boolean>;
  onCreateWatch: (input: {
    title: string;
    projectId: string;
    minutes: number;
    categories: (
      | 'review_requested'
      | 'mentioned'
      | 'assigned'
      | 'failed_check'
    )[];
  }) => Promise<boolean>;
  onDecision: (
    routineId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onPause: (routineId: string) => Promise<boolean>;
  onResume: (routineId: string) => Promise<boolean>;
  onRunNow: (routineId: string) => Promise<RoutineRunResource | undefined>;
}) {
  const [creating, setCreating] = useState<'machine' | 'watch'>();
  const [title, setTitle] = useState('Morning Vera health check');
  const [machineId, setMachineId] = useState(props.machines[0]?.id ?? '');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [localTime, setLocalTime] = useState('08:00');
  const [days, setDays] = useState(DAYS.map(({ value }) => value));
  const [projectId, setProjectId] = useState(props.projects[0]?.id ?? '');
  const [intervalMinutes, setIntervalMinutes] = useState('15');
  const [categories, setCategories] = useState<
    ('review_requested' | 'mentioned' | 'assigned' | 'failed_check')[]
  >(['review_requested', 'mentioned', 'assigned', 'failed_check']);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const machine = props.machines.find(({ id }) => id === machineId);
  const githubConnected = props.connections.some(
    ({ integrationId, status }) =>
      integrationId === 'github' && status === 'active',
  );

  useEffect(() => {
    if (
      props.machines.length > 0 &&
      !props.machines.some(({ id }) => id === machineId)
    ) {
      setMachineId(props.machines[0]?.id ?? '');
      setServiceIds([]);
    }
  }, [machineId, props.machines]);

  useEffect(() => {
    if (
      props.projects.length > 0 &&
      !props.projects.some(({ id }) => id === projectId)
    )
      setProjectId(props.projects[0]?.id ?? '');
  }, [projectId, props.projects]);

  async function submit() {
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/u.test(localTime) ||
      title.trim().length === 0 ||
      machineId.length === 0 ||
      days.length === 0
    )
      return;
    if (
      await props.onCreate({
        title: title.trim(),
        machineId,
        ...(serviceIds.length === 0 ? {} : { serviceIds }),
        localTime,
        daysOfWeek: days,
        timeZone,
      })
    )
      setCreating(undefined);
  }

  async function submitWatch() {
    const minutes = Number(intervalMinutes);
    const project = props.projects.find(({ id }) => id === projectId);
    if (
      project === undefined ||
      !githubConnected ||
      categories.length === 0 ||
      !Number.isInteger(minutes) ||
      minutes < 5 ||
      minutes > 1_440
    )
      return;
    if (
      await props.onCreateWatch({
        title: `Watch ${project.displayName} on GitHub`,
        projectId,
        minutes,
        categories,
      })
    )
      setCreating(undefined);
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: spacing.md,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{ color: palette.text, fontSize: 18, fontWeight: '700' }}
          >
            Standing routines
          </Text>
          <Text style={{ color: palette.muted, lineHeight: 19 }}>
            Approved observations Vera can run on schedule—even after a restart.
          </Text>
        </View>
        <SmallButton
          icon={creating === undefined ? Plus : X}
          label={creating === undefined ? 'New' : 'Close'}
          onPress={() =>
            setCreating((value) => (value ? undefined : 'machine'))
          }
        />
      </View>

      {creating === undefined ? null : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Choice
            label="Machine check"
            selected={creating === 'machine'}
            onPress={() => setCreating('machine')}
          />
          <Choice
            label="GitHub watch"
            selected={creating === 'watch'}
            onPress={() => setCreating('watch')}
          />
        </View>
      )}

      {creating === 'machine' ? (
        <View style={cardStyle}>
          <Text style={eyebrowStyle}>NEW STANDING INSTRUCTION</Text>
          <Field label="Name">
            <TextInput
              accessibilityLabel="Routine name"
              onChangeText={setTitle}
              style={inputStyle}
              value={title}
            />
          </Field>
          <Field label="Machine">
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              {props.machines.map((candidate) => (
                <Choice
                  key={candidate.id}
                  label={candidate.displayName}
                  selected={candidate.id === machineId}
                  onPress={() => {
                    setMachineId(candidate.id);
                    setServiceIds([]);
                  }}
                />
              ))}
            </View>
          </Field>
          {machine === undefined ? null : (
            <Field label="Services (none means every registered service)">
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                {machine.services.map((service) => (
                  <Choice
                    key={service.id}
                    label={service.displayName}
                    selected={serviceIds.includes(service.id)}
                    onPress={() =>
                      setServiceIds((current) =>
                        current.includes(service.id)
                          ? current.filter((id) => id !== service.id)
                          : [...current, service.id],
                      )
                    }
                  />
                ))}
              </View>
            </Field>
          )}
          <Field label={`Local time · ${timeZone}`}>
            <TextInput
              accessibilityLabel="Daily routine time"
              autoCapitalize="none"
              inputMode="text"
              maxLength={5}
              onChangeText={setLocalTime}
              placeholder="08:00"
              placeholderTextColor={palette.faint}
              style={inputStyle}
              value={localTime}
            />
          </Field>
          <Field label="Days">
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {DAYS.map((day) => (
                <Choice
                  compact
                  key={`${String(day.value)}-${day.label}`}
                  label={day.label}
                  selected={days.includes(day.value)}
                  onPress={() =>
                    setDays((current) =>
                      current.includes(day.value)
                        ? current.filter((value) => value !== day.value)
                        : [...current, day.value],
                    )
                  }
                />
              ))}
            </View>
          </Field>
          <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
            Approval grants recurring read-only inspection of only this machine
            and these services. Vera cannot restart or modify anything.
          </Text>
          <SmallButton
            icon={ShieldCheck}
            label="Create for approval"
            onPress={() => void submit()}
            disabled={props.actionId === 'create' || machineId.length === 0}
          />
        </View>
      ) : null}

      {creating === 'watch' ? (
        <View style={cardStyle}>
          <Text style={eyebrowStyle}>NEW READ-ONLY WATCH</Text>
          <Field label="Registered project">
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              {props.projects.map((project) => (
                <Choice
                  key={project.id}
                  label={project.displayName}
                  selected={project.id === projectId}
                  onPress={() => setProjectId(project.id)}
                />
              ))}
            </View>
          </Field>
          <Field label="Check every 5–1440 minutes">
            <TextInput
              accessibilityLabel="GitHub watch interval in minutes"
              inputMode="numeric"
              maxLength={4}
              onChangeText={setIntervalMinutes}
              placeholder="15"
              placeholderTextColor={palette.faint}
              style={inputStyle}
              value={intervalMinutes}
            />
          </Field>
          <Field label="Bring these signals into Today">
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              {(
                [
                  ['review_requested', 'Review requests'],
                  ['mentioned', 'Mentions'],
                  ['assigned', 'Assignments'],
                  ['failed_check', 'Failed checks'],
                ] as const
              ).map(([value, label]) => (
                <Choice
                  key={value}
                  label={label}
                  selected={categories.includes(value)}
                  onPress={() =>
                    setCategories((current) =>
                      current.includes(value)
                        ? current.filter((category) => category !== value)
                        : [...current, value],
                    )
                  }
                />
              ))}
            </View>
          </Field>
          <Text
            selectable
            style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}
          >
            {githubConnected
              ? 'Approval grants recurring read-only access to exactly this repository and GitHub account. It never grants issue, pull-request, or repository writes.'
              : 'Connect GitHub in Connections before creating a watch.'}
          </Text>
          <SmallButton
            icon={ShieldCheck}
            label="Create for approval"
            onPress={() => void submitWatch()}
            disabled={
              props.actionId === 'create' ||
              !githubConnected ||
              projectId.length === 0 ||
              categories.length === 0
            }
          />
        </View>
      ) : null}

      {props.routines.length === 0 && creating === undefined ? (
        <View
          style={[
            cardStyle,
            { alignItems: 'center', paddingVertical: spacing.xxl },
          ]}
        >
          <Clock3 color={palette.accent} size={26} />
          <Text
            style={{ color: palette.text, fontSize: 16, fontWeight: '600' }}
          >
            No routines yet
          </Text>
          <Text
            style={{
              color: palette.muted,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            Create a machine check or external watch. Vera stays quiet unless
            something needs you.
          </Text>
        </View>
      ) : null}
      {props.routines.map((routine) => (
        <RoutineCard
          key={routine.id}
          routine={routine}
          machineName={machineNameFor(routine, props.machines)}
          latestRun={props.runs[routine.id]?.[0]}
          busy={props.actionId === routine.id}
          onDecision={props.onDecision}
          onPause={props.onPause}
          onResume={props.onResume}
          onRunNow={props.onRunNow}
        />
      ))}
    </View>
  );
}

function RoutineCard(props: {
  routine: RoutineResource;
  machineName?: string;
  latestRun?: RoutineRunResource;
  busy: boolean;
  onDecision: (
    id: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onPause: (id: string) => Promise<boolean>;
  onResume: (id: string) => Promise<boolean>;
  onRunNow: (id: string) => Promise<RoutineRunResource | undefined>;
}) {
  const effect = props.routine.approval.effect;
  return (
    <View style={cardStyle}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: spacing.md,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={eyebrowStyle}>
            {props.routine.status.replaceAll('_', ' ').toUpperCase()}
          </Text>
          <Text
            style={{ color: palette.text, fontSize: 16, fontWeight: '600' }}
          >
            {effect.title}
          </Text>
        </View>
        {effect.action.kind === 'integration_awareness' ? (
          <GitPullRequest
            color={
              props.routine.status === 'active' ? palette.accent : palette.muted
            }
            size={20}
          />
        ) : (
          <Activity
            color={
              props.routine.status === 'active' ? palette.accent : palette.muted
            }
            size={20}
          />
        )}
      </View>
      <Text style={{ color: palette.textSoft, lineHeight: 20 }}>
        {effect.schedule.kind === 'daily'
          ? `${scheduleLabel(effect.schedule.daysOfWeek)} at ${effect.schedule.localTime} · ${effect.schedule.timeZone}`
          : `Every ${String(effect.schedule.minutes)} minutes`}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 12 }}>
        {effect.action.kind === 'machine_health_check'
          ? `Machine: ${props.machineName ?? effect.action.machineId} · ${effect.action.serviceIds?.join(', ') ?? 'all services'}`
          : `GitHub: ${effect.action.repository.owner}/${effect.action.repository.name} · @${effect.action.account.login}`}
      </Text>
      {effect.action.kind === 'integration_awareness' ? (
        <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
          Signals:{' '}
          {effect.action.categories
            .map((category) => SIGNAL_LABELS[category])
            .join(', ')}
        </Text>
      ) : null}
      {props.routine.nextRunAt === undefined ? null : (
        <Text style={{ color: palette.muted, fontSize: 12 }}>
          Next: {new Date(props.routine.nextRunAt).toLocaleString()}
        </Text>
      )}
      {props.latestRun === undefined ? null : (
        <View
          style={{
            gap: 5,
            borderTopWidth: 1,
            borderTopColor: palette.lineSoft,
            paddingTop: spacing.md,
          }}
        >
          <Text
            style={{ color: palette.muted, fontSize: 10, fontWeight: '700' }}
          >
            LATEST RUN ·{' '}
            {props.latestRun.status.replaceAll('_', ' ').toUpperCase()}
          </Text>
          <Text
            style={{ color: palette.textSoft, fontSize: 12, lineHeight: 18 }}
          >
            {props.latestRun.result?.summary ??
              props.latestRun.failure?.message ??
              (props.latestRun.status === 'queued'
                ? 'Waiting for Vera to begin.'
                : props.latestRun.status === 'executing'
                  ? effect.action.kind === 'machine_health_check'
                    ? 'Vera is inspecting the machine now.'
                    : 'Vera is checking GitHub now.'
                  : 'This run was cancelled before execution.')}
          </Text>
          <Text style={{ color: palette.faint, fontSize: 11 }}>
            {new Date(
              props.latestRun.completedAt ?? props.latestRun.createdAt,
            ).toLocaleString()}
          </Text>
        </View>
      )}
      {props.routine.status === 'awaiting_approval' ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: palette.accent, fontSize: 11, lineHeight: 17 }}>
            {effect.action.kind === 'machine_health_check'
              ? 'Read-only inspection · No service control · No self-modification'
              : 'Read-only observation · No external writes · No self-modification'}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <SmallButton
              icon={Check}
              label="Approve"
              onPress={() =>
                void props.onDecision(props.routine.id, 'approved')
              }
              disabled={props.busy}
            />
            <SmallButton
              icon={X}
              label="Reject"
              onPress={() =>
                void props.onDecision(props.routine.id, 'rejected')
              }
              disabled={props.busy}
            />
          </View>
        </View>
      ) : null}
      {props.routine.status === 'active' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <SmallButton
            icon={Play}
            label="Run now"
            onPress={() => void props.onRunNow(props.routine.id)}
            disabled={props.busy}
          />
          <SmallButton
            icon={Pause}
            label="Pause"
            onPress={() => void props.onPause(props.routine.id)}
            disabled={props.busy}
          />
        </View>
      ) : null}
      {props.routine.status === 'paused' ? (
        <SmallButton
          icon={Play}
          label="Resume"
          onPress={() => void props.onResume(props.routine.id)}
          disabled={props.busy}
        />
      ) : null}
    </View>
  );
}

function scheduleLabel(days: number[]) {
  const ordered = [...days].sort((left, right) => left - right);
  if (ordered.length === 7) return 'Every day';
  if (ordered.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (ordered.join(',') === '0,6') return 'Weekends';
  return ordered.map((day) => DAY_NAMES[day] ?? String(day)).join(', ');
}

function machineNameFor(
  routine: RoutineResource,
  machines: MachineCatalogResource['machines'],
) {
  const action = routine.approval.effect.action;
  if (action.kind !== 'machine_health_check') return undefined;
  return (
    machines.find(({ id }) => id === action.machineId)?.displayName ??
    action.machineId
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: palette.muted, fontSize: 11, fontWeight: '600' }}>
        {props.label}
      </Text>
      {props.children}
    </View>
  );
}
function Choice(props: {
  label: string;
  selected: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minWidth: props.compact ? 34 : undefined,
        minHeight: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: props.selected ? palette.accentLine : palette.line,
        borderRadius: radius.pill,
        paddingHorizontal: props.compact ? 8 : spacing.md,
        opacity: pressed ? 0.7 : 1,
        backgroundColor: props.selected
          ? palette.accentSurface
          : palette.surface,
      })}
    >
      <Text
        style={{
          color: props.selected ? palette.accent : palette.textSoft,
          fontWeight: '600',
          fontSize: 12,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
function SmallButton(props: {
  icon: typeof Plus;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        borderWidth: 1,
        borderColor: palette.line,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        opacity: props.disabled ? 0.45 : pressed ? 0.7 : 1,
        backgroundColor: palette.surface,
      })}
    >
      <Icon color={palette.accent} size={15} />
      <Text style={{ color: palette.text, fontSize: 12, fontWeight: '600' }}>
        {props.label}
      </Text>
    </Pressable>
  );
}
const cardStyle = {
  gap: spacing.md,
  borderWidth: 1,
  borderColor: palette.lineSoft,
  borderRadius: radius.lg,
  padding: spacing.lg,
  backgroundColor: palette.surface,
} as const;
const inputStyle = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: palette.line,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  color: palette.text,
  backgroundColor: palette.canvas,
} as const;
const eyebrowStyle = {
  color: palette.accent,
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 0.8,
} as const;
