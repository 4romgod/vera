import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseStoredRoutine,
  parseStoredRoutineRun,
} from '../../../src/domain/routines/routine-compatibility.ts';

const legacyRoutine = {
  schemaVersion: 1,
  version: 3,
  id: 'routine_legacy',
  requestKey: 'legacy',
  principalId: 'owner_v1',
  status: 'active',
  approval: {
    id: 'approval_legacy',
    status: 'approved',
    reason: 'standing_instruction',
    effect: {
      title: 'Daily health',
      schedule: {
        kind: 'daily',
        timeZone: 'UTC',
        localTime: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      action: { kind: 'machine_health_check', machineId: 'macmini' },
      authority: {
        recurringExecution: true,
        inspectRegisteredMachine: true,
        controlMachineServices: false,
        modifyRoutine: false,
      },
    },
    requestedAt: '2026-09-01T00:00:00.000Z',
    decidedAt: '2026-09-01T00:01:00.000Z',
    decidedBy: 'owner_v1',
  },
  nextRunAt: '2026-09-06T06:00:00.000Z',
  events: [
    {
      schemaVersion: 1,
      id: 'event_1',
      sequence: 1,
      type: 'routine_created',
      occurredAt: '2026-09-01T00:00:00.000Z',
      data: {},
    },
  ],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:01:00.000Z',
};

void describe('routine schema compatibility', () => {
  void it('upgrades a stored version 1 routine into the trigger contract', () => {
    const routine = parseStoredRoutine(legacyRoutine);
    assert.equal(routine.schemaVersion, 2);
    assert.deepEqual(routine.approval.effect.trigger, {
      kind: 'schedule',
      schedule: legacyRoutine.approval.effect.schedule,
    });
    assert.equal(routine.approval.effect.limits, undefined);
    assert.equal(
      'schedule' in routine.approval.effect,
      false,
      'the legacy field must not survive the upgrade',
    );
    assert.equal(routine.version, 3);
  });

  void it('leaves an already-current routine untouched', () => {
    const upgraded = parseStoredRoutine(legacyRoutine);
    assert.deepEqual(parseStoredRoutine(upgraded), upgraded);
  });

  void it('upgrades a stored version 1 routine run', () => {
    const run = parseStoredRoutineRun({
      schemaVersion: 1,
      version: 2,
      id: 'routine_run_legacy',
      routineId: 'routine_legacy',
      principalId: 'owner_v1',
      occurrenceKey: 'scheduled:2026-09-05T06:00:00.000Z',
      trigger: 'scheduled',
      scheduledFor: '2026-09-05T06:00:00.000Z',
      action: { kind: 'machine_health_check', machineId: 'macmini' },
      status: 'cancelled',
      startedAt: '2026-09-05T06:00:01.000Z',
      completedAt: '2026-09-05T06:00:02.000Z',
      createdAt: '2026-09-05T06:00:00.000Z',
      updatedAt: '2026-09-05T06:00:02.000Z',
    });
    assert.equal(run.schemaVersion, 2);
    assert.equal(run.signal, undefined);
  });

  void it('refuses a version 1 document that is not actually version 1 shaped', () => {
    assert.throws(() =>
      parseStoredRoutine({ ...legacyRoutine, approval: undefined }),
    );
  });
});
