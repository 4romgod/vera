import {
  RoutineRunSchema,
  RoutineSchema,
  type Routine,
  type RoutineRun,
} from './routine.ts';

// ADR-0050 replaced `approval.effect.schedule` with a closed trigger union and
// moved routines and routine runs to schemaVersion 2. Stored version 1
// documents are upgraded here explicitly; they are never reinterpreted in
// place and never written back as version 1.
function upgradeRoutineValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const routine = value as Record<string, unknown>;
  if (routine.schemaVersion !== 1) return value;
  const approval = routine.approval as Record<string, unknown> | undefined;
  const effect = approval?.effect as Record<string, unknown> | undefined;
  if (effect === undefined || !('schedule' in effect)) return value;
  const { schedule, ...remainingEffect } = effect;
  return {
    ...routine,
    schemaVersion: 2,
    approval: {
      ...approval,
      effect: { ...remainingEffect, trigger: { kind: 'schedule', schedule } },
    },
  };
}

function upgradeRoutineRunValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const run = value as Record<string, unknown>;
  if (run.schemaVersion !== 1) return value;
  return { ...run, schemaVersion: 2 };
}

export function parseStoredRoutine(value: unknown): Routine {
  return RoutineSchema.parse(upgradeRoutineValue(value));
}

export function parseStoredRoutineRun(value: unknown): RoutineRun {
  return RoutineRunSchema.parse(upgradeRoutineRunValue(value));
}
