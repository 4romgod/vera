import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advancedCursor,
  occurrenceKeyFor,
  planSignalOccurrences,
  signalMatchesTrigger,
  startOfUtcDay,
} from '../../../src/application/routines/routine-signal-occurrences.ts';
import type { ExternalSignal } from '../../../src/domain/external-awareness/external-signal.ts';

const limits = {
  expiresAt: '2026-10-01T00:00:00.000Z',
  maxOccurrencesPerDay: 3,
  maxTotalOccurrences: 10,
};

const trigger = {
  kind: 'external_signal' as const,
  integrationId: 'github' as const,
  project: { id: 'project_alpha', displayName: 'Alpha' },
  categories: ['failed_check' as const, 'review_requested' as const],
};

function signalLike(overrides: Partial<ExternalSignal>) {
  return {
    id: 'external_signal_alpha',
    version: 1,
    integrationId: 'github',
    project: { id: 'project_alpha', displayName: 'Alpha' },
    category: 'failed_check',
    lastObservedAt: '2026-09-05T10:00:00.000Z',
    ...overrides,
  } as ExternalSignal;
}

void describe('signal occurrence planning', () => {
  void it('expires on the expiry instant before spending any budget', () => {
    assert.deepEqual(
      planSignalOccurrences({
        limits,
        now: limits.expiresAt,
        totalOccurrences: 0,
        todayOccurrences: 0,
      }),
      { kind: 'expired', reason: 'expiry_reached' },
    );
  });

  void it('expires once the total budget is consumed', () => {
    assert.deepEqual(
      planSignalOccurrences({
        limits,
        now: '2026-09-05T10:00:00.000Z',
        totalOccurrences: 10,
        todayOccurrences: 0,
      }),
      { kind: 'expired', reason: 'budget_exhausted' },
    );
  });

  void it('caps capacity by whichever budget binds first', () => {
    assert.deepEqual(
      planSignalOccurrences({
        limits,
        now: '2026-09-05T10:00:00.000Z',
        totalOccurrences: 9,
        todayOccurrences: 0,
      }),
      { kind: 'capacity', capacity: 1 },
    );
    assert.deepEqual(
      planSignalOccurrences({
        limits,
        now: '2026-09-05T10:00:00.000Z',
        totalOccurrences: 0,
        todayOccurrences: 3,
      }),
      { kind: 'capacity', capacity: 0 },
    );
    assert.deepEqual(
      planSignalOccurrences({
        limits,
        now: '2026-09-05T10:00:00.000Z',
        totalOccurrences: 0,
        todayOccurrences: 5,
      }),
      { kind: 'capacity', capacity: 0 },
      'an over-consumed day must never produce negative capacity',
    );
  });

  void it('keys an occurrence by signal generation', () => {
    assert.equal(
      occurrenceKeyFor({ id: 'external_signal_a', version: 4 }),
      'signal:external_signal_a:4',
    );
  });

  void it('starts the day at UTC midnight', () => {
    assert.equal(
      startOfUtcDay('2026-09-05T23:59:59.999Z'),
      '2026-09-05T00:00:00.000Z',
    );
  });

  void it('matches only the approved integration, project, and categories', () => {
    assert.equal(signalMatchesTrigger(signalLike({}), trigger), true);
    assert.equal(
      signalMatchesTrigger(signalLike({ category: 'mentioned' }), trigger),
      false,
    );
    assert.equal(
      signalMatchesTrigger(
        signalLike({ project: { id: 'project_beta', displayName: 'Beta' } }),
        trigger,
      ),
      false,
    );
    assert.equal(
      signalMatchesTrigger(signalLike({ integrationId: 'gitlab' }), trigger),
      false,
    );
  });

  void it('advances the cursor only forward', () => {
    const signals = [
      signalLike({ lastObservedAt: '2026-09-05T10:00:00.000Z' }),
      signalLike({ lastObservedAt: '2026-09-05T11:00:00.000Z' }),
    ];
    assert.deepEqual(advancedCursor(undefined, signals), {
      observedAt: '2026-09-05T11:00:00.000Z',
      signalId: 'external_signal_alpha',
      signalVersion: 1,
    });
    assert.equal(
      advancedCursor(
        {
          observedAt: '2026-09-05T12:00:00.000Z',
          signalId: 'external_signal_alpha',
          signalVersion: 1,
        },
        signals,
      ),
      undefined,
      'a later cursor must never regress',
    );
    assert.equal(
      advancedCursor(
        {
          observedAt: '2026-09-05T09:00:00.000Z',
          signalId: 'external_signal_alpha',
          signalVersion: 1,
        },
        [],
      ),
      undefined,
    );
  });

  void it('orders equal timestamps by signal identity and generation', () => {
    assert.deepEqual(
      advancedCursor(undefined, [
        signalLike({ id: 'external_signal_b', version: 1 }),
        signalLike({ id: 'external_signal_a', version: 2 }),
      ]),
      {
        observedAt: '2026-09-05T10:00:00.000Z',
        signalId: 'external_signal_b',
        signalVersion: 1,
      },
    );
    assert.deepEqual(
      advancedCursor(
        {
          observedAt: '2026-09-05T10:00:00.000Z',
          signalId: 'external_signal_a',
          signalVersion: 1,
        },
        [signalLike({ id: 'external_signal_a', version: 2 })],
      ),
      {
        observedAt: '2026-09-05T10:00:00.000Z',
        signalId: 'external_signal_a',
        signalVersion: 2,
      },
    );
  });
});
