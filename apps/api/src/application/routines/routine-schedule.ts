import type { RoutineSchedule } from '../../domain/routines/routine.ts';

const MINUTE_MS = 60_000;
const SEARCH_MINUTES = 8 * 24 * 60;

type LocalMinute = {
  date: string;
  time: string;
  dayOfWeek: number;
};

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localMinute(date: Date, timeZone: string): LocalMinute {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const weekday = value('weekday');
  const dayOfWeek = weekday === undefined ? undefined : WEEKDAY[weekday];
  if (dayOfWeek === undefined)
    throw new Error('Could not resolve local weekday.');
  return {
    date: `${value('year') ?? ''}-${value('month') ?? ''}-${value('day') ?? ''}`,
    time: `${value('hour') ?? ''}:${value('minute') ?? ''}`,
    dayOfWeek,
  };
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new Error(`Time zone "${timeZone}" is not a valid IANA time zone.`);
  }
}

export function nextRoutineOccurrence(
  schedule: RoutineSchedule,
  after: Date,
  previousOccurrence?: string,
): string {
  assertValidTimeZone(schedule.timeZone);
  const previousLocalDate =
    previousOccurrence === undefined
      ? undefined
      : localMinute(new Date(previousOccurrence), schedule.timeZone).date;
  const start = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let offset = 0; offset < SEARCH_MINUTES; offset += 1) {
    const candidate = new Date(start + offset * MINUTE_MS);
    const local = localMinute(candidate, schedule.timeZone);
    if (
      local.time === schedule.localTime &&
      schedule.daysOfWeek.includes(local.dayOfWeek) &&
      local.date !== previousLocalDate
    ) {
      return candidate.toISOString();
    }
  }
  throw new Error(
    'Could not resolve the next routine occurrence within eight days.',
  );
}
