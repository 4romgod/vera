import type { ExternalSignal } from '../../domain/external-awareness/external-signal.ts';
import type {
  ExternalSignalTrigger,
  RoutineLimits,
  RoutineSignalCursor,
} from '../../domain/routines/routine.ts';

export type RoutineExpiry = 'expiry_reached' | 'budget_exhausted';

export type SignalOccurrencePlan =
  | { kind: 'expired'; reason: RoutineExpiry }
  | { kind: 'capacity'; capacity: number };

export function startOfUtcDay(now: string): string {
  return `${now.slice(0, 10)}T00:00:00.000Z`;
}

export function occurrenceKeyFor(signal: {
  id: string;
  version: number;
}): string {
  return `signal:${signal.id}:${String(signal.version)}`;
}

export function frozenSignalGeneration(signal: ExternalSignal) {
  return {
    id: signal.id,
    version: signal.version,
    category: signal.category,
    externalKey: signal.externalKey,
    url: signal.url,
    observedAt: signal.lastObservedAt,
  };
}

// Budget is derived from durable runs rather than a mutable counter, so a lost
// race between workers can neither inflate nor deflate the owner's ceiling.
export function planSignalOccurrences(input: {
  limits: RoutineLimits;
  now: string;
  totalOccurrences: number;
  todayOccurrences: number;
}): SignalOccurrencePlan {
  if (input.now >= input.limits.expiresAt)
    return { kind: 'expired', reason: 'expiry_reached' };
  if (input.totalOccurrences >= input.limits.maxTotalOccurrences)
    return { kind: 'expired', reason: 'budget_exhausted' };
  return {
    kind: 'capacity',
    capacity: Math.max(
      0,
      Math.min(
        input.limits.maxOccurrencesPerDay - input.todayOccurrences,
        input.limits.maxTotalOccurrences - input.totalOccurrences,
      ),
    ),
  };
}

export function signalMatchesTrigger(
  signal: ExternalSignal,
  trigger: ExternalSignalTrigger,
): boolean {
  return (
    signal.integrationId === trigger.integrationId &&
    signal.project.id === trigger.project.id &&
    trigger.categories.includes(signal.category)
  );
}

export function advancedCursor(
  current: RoutineSignalCursor | undefined,
  admitted: ExternalSignal[],
): RoutineSignalCursor | undefined {
  const latest = admitted.reduce<RoutineSignalCursor | undefined>(
    (highest, signal) => {
      const cursor = {
        observedAt: signal.lastObservedAt,
        signalId: signal.id,
        signalVersion: signal.version,
      };
      return highest === undefined || compareSignalCursors(cursor, highest) > 0
        ? cursor
        : highest;
    },
    undefined,
  );
  if (latest === undefined) return undefined;
  return current === undefined || compareSignalCursors(latest, current) > 0
    ? latest
    : undefined;
}

export function compareSignalCursors(
  left: RoutineSignalCursor,
  right: RoutineSignalCursor,
): number {
  return (
    left.observedAt.localeCompare(right.observedAt) ||
    left.signalId.localeCompare(right.signalId) ||
    left.signalVersion - right.signalVersion
  );
}
