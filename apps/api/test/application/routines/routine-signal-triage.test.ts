import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExternalSignalStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-external-signal-store.ts';
import { InMemoryRoutineStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-routine-store.ts';
import { InMemoryWorkLeaseStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-work-lease-store.ts';
import { createRoutineWorker } from '../../../src/application/routines/routine-worker.ts';
import { createRoutineLifecycle } from '../../../src/application/routines/routine-lifecycle.ts';
import { ExternalSignalSchema } from '../../../src/domain/external-awareness/external-signal.ts';
import type { ExternalSignal } from '../../../src/domain/external-awareness/external-signal.ts';
import type { RoutineProposalArguments } from '../../../src/domain/routines/routine.ts';
import type { ExternalAwarenessOperations } from '../../../src/ports/external-awareness/external-awareness-operations.ts';
import type { ExternalSignalTriageStarter } from '../../../src/ports/external-awareness/external-signal-triage.ts';
import type { MachineOperations } from '../../../src/ports/machines/machine-operations.ts';

const PROJECT = { id: 'project_alpha', displayName: 'Alpha' };

const machines: MachineOperations = {
  catalog: { schemaVersion: 1, machines: [] },
  destinationFor: () => ({
    schemaVersion: 1,
    adapterId: 'test',
    provider: 'test',
    transport: 'local_process',
    dataBoundary: 'owner_controlled',
  }),
  resolve: () => null,
  checkReadiness: () => Promise.resolve(),
  inspect: () => {
    throw new Error('Signal triage must never inspect a machine.');
  },
  manageService: () => {
    throw new Error('Signal triage must never control services.');
  },
};

function signal(input: {
  key: string;
  version?: number;
  category?: ExternalSignal['category'];
  status?: ExternalSignal['status'];
  observedAt: string;
  projectId?: string;
  summary?: string;
}): ExternalSignal {
  return ExternalSignalSchema.parse({
    schemaVersion: 1,
    version: input.version ?? 1,
    id: `external_signal_${input.key}`,
    principalId: 'owner_v1',
    routineId: 'routine_watch',
    integrationId: 'github',
    connectionId: 'connection_gh',
    project:
      input.projectId === undefined
        ? PROJECT
        : { id: input.projectId, displayName: 'Other' },
    repository: { provider: 'github', owner: 'acme', name: 'alpha' },
    externalKey: input.key,
    category: input.category ?? 'failed_check',
    title: `Checks failing on ${input.key}`,
    summary: input.summary ?? 'One required check reported failure.',
    url: 'https://github.com/acme/alpha/pull/42',
    occurredAt: input.observedAt,
    status: input.status ?? 'active',
    firstObservedAt: input.observedAt,
    lastObservedAt: input.observedAt,
    ...(input.status === 'resolved' ? { resolvedAt: input.observedAt } : {}),
  });
}

function awarenessOver(
  signals: InMemoryExternalSignalStore,
): ExternalAwarenessOperations {
  return {
    get: async (principalId, signalId) => {
      const found = await signals.findById(principalId, signalId);
      if (found === null) throw new Error(`Unknown signal ${signalId}.`);
      return found;
    },
    list: (principalId, limit = 100) => signals.listActive(principalId, limit),
    listByRoutine: (principalId, routineId, limit = 100) =>
      signals.listByRoutine(principalId, routineId, limit),
    listRespondable: (input) => signals.listRespondable(input),
    freezeTrigger: (input) =>
      Promise.resolve({
        kind: 'external_signal',
        integrationId: input.integrationId,
        project: PROJECT,
        categories: [...input.categories].sort(),
      }),
    freeze: () => Promise.reject(new Error('Not used by this test.')),
    execute: () => Promise.reject(new Error('Not used by this test.')),
  };
}

function triageRecorder() {
  const calls: { signalId: string; requestKey: string }[] = [];
  const starter: ExternalSignalTriageStarter = {
    handle: (input) => {
      calls.push({ signalId: input.signalId, requestKey: input.requestKey });
      return Promise.resolve({
        schemaVersion: 1,
        version: 1,
        task: {
          id: `task_${String(calls.length)}`,
          requestKey: input.requestKey,
          principalId: input.principalId,
          conversationId: `conversation_${String(calls.length)}`,
          message: 'Handle the signal.',
          status: 'running',
          createdAt: '2026-09-05T10:00:00.000Z',
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
        run: {
          id: `run_${String(calls.length)}`,
          status: 'deciding',
          createdAt: '2026-09-05T10:00:00.000Z',
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
        events: [],
        createdAt: '2026-09-05T10:00:00.000Z',
        updatedAt: '2026-09-05T10:00:00.000Z',
      } as never);
    },
  };
  return { calls, starter };
}

function proposal(
  overrides: Partial<{
    categories: ExternalSignal['category'][];
    expiresAt: string;
    maxOccurrencesPerDay: number;
    maxTotalOccurrences: number;
  }> = {},
): RoutineProposalArguments {
  return {
    title: 'Triage Alpha failures',
    trigger: {
      kind: 'external_signal',
      integrationId: 'github',
      projectId: PROJECT.id,
      categories: overrides.categories ?? ['failed_check'],
    },
    action: {
      kind: 'signal_triage',
      response: 'investigate_and_propose',
      disclosure: 'minimized_signal_evidence',
    },
    limits: {
      expiresAt: overrides.expiresAt ?? '2026-10-05T00:00:00.000Z',
      maxOccurrencesPerDay: overrides.maxOccurrencesPerDay ?? 5,
      maxTotalOccurrences: overrides.maxTotalOccurrences ?? 20,
    },
  };
}

async function harness(options?: {
  now?: Date;
  proposal?: RoutineProposalArguments;
  signalOccurrenceBatch?: number;
}) {
  const store = new InMemoryRoutineStore();
  const signals = new InMemoryExternalSignalStore();
  const triage = triageRecorder();
  const clock = { now: options?.now ?? new Date('2026-09-05T10:00:00.000Z') };
  const lifecycle = createRoutineLifecycle({
    store,
    machines,
    externalAwareness: awarenessOver(signals),
    signalTriage: triage.starter,
    ...(options?.signalOccurrenceBatch === undefined
      ? {}
      : { signalOccurrenceBatch: options.signalOccurrenceBatch }),
    clock: () => clock.now,
    createId: (() => {
      let id = 0;
      return (prefix: string) => `${prefix}_test_${String(++id)}`;
    })(),
  });
  const created = await lifecycle.create({
    ...(options?.proposal ?? proposal()),
    principalId: 'owner_v1',
    requestKey: 'triage-routine',
  });
  return { store, signals, triage, clock, lifecycle, created };
}

void describe('event-triggered signal triage routines', () => {
  void it('freezes exact standing authority and stays inert until approved', async () => {
    const { lifecycle, signals, created } = await harness();
    assert.equal(created.status, 'awaiting_approval');
    assert.equal(created.nextRunAt, undefined);
    assert.deepEqual(created.approval.effect.authority, {
      eventTriggeredExecution: true,
      readExternalSignals: true,
      startTriageConversation: true,
      modifyExternalService: false,
      applyChanges: false,
      modifyRoutine: false,
    });
    assert.deepEqual(created.approval.effect.trigger, {
      kind: 'external_signal',
      integrationId: 'github',
      project: PROJECT,
      categories: ['failed_check'],
    });
    await signals.upsert(
      signal({ key: 'pr-42', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    assert.deepEqual(await lifecycle.materializeSignalOccurrences(created), []);
  });

  void it('creates exactly one durable occurrence per signal generation', async () => {
    const { lifecycle, signals, created, store } = await harness();
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await signals.upsert(
      signal({ key: 'pr-42', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    const first = await lifecycle.materializeSignalOccurrences(approved);
    assert.equal(first.length, 1);
    const [firstRun] = first;
    assert.ok(firstRun);
    assert.equal(firstRun.trigger, 'external_signal');
    assert.equal(firstRun.occurrenceKey, 'signal:external_signal_pr-42:1');
    assert.equal(firstRun.signal?.version, 1);

    // Re-running the same discovery must not duplicate the occurrence.
    assert.deepEqual(
      await lifecycle.materializeSignalOccurrences(approved),
      [],
    );
    assert.equal(
      await store.countRuns({
        principalId: 'owner_v1',
        routineId: created.id,
      }),
      1,
    );

    // A new generation of the same signal is new evidence.
    await signals.upsert(
      signal({
        key: 'pr-42',
        version: 2,
        observedAt: '2026-09-05T10:01:00.000Z',
        summary: 'A second required check reported failure.',
      }),
    );
    const [secondRun] = await lifecycle.materializeSignalOccurrences(approved);
    assert.ok(secondRun);
    assert.equal(secondRun.occurrenceKey, 'signal:external_signal_pr-42:2');
    assert.notEqual(secondRun.id, firstRun.id);
  });

  void it('does not strand signals that share an observation timestamp', async () => {
    const { lifecycle, signals, created, store } = await harness({
      proposal: proposal({
        maxOccurrencesPerDay: 50,
        maxTotalOccurrences: 50,
      }),
      signalOccurrenceBatch: 1,
    });
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    for (let index = 0; index < 22; index += 1) {
      await signals.upsert(
        signal({
          key: `same-time-${String(index).padStart(2, '0')}`,
          observedAt: '2026-09-05T10:01:00.000Z',
        }),
      );
    }
    for (let index = 0; index < 22; index += 1) {
      assert.equal(
        (await lifecycle.materializeSignalOccurrences(approved)).length,
        1,
      );
    }
    assert.equal(
      await store.countRuns({
        principalId: 'owner_v1',
        routineId: created.id,
      }),
      22,
    );
    assert.deepEqual(
      await lifecycle.materializeSignalOccurrences(approved),
      [],
    );
  });

  void it('starts one triage per occurrence with the run as the idempotency key', async () => {
    const { lifecycle, signals, created, triage } = await harness();
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await signals.upsert(
      signal({ key: 'pr-42', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    const [run] = await lifecycle.materializeSignalOccurrences(approved);
    assert.ok(run);
    const executed = await lifecycle.executeRun('owner_v1', run.id);
    assert.equal(executed.status, 'succeeded');
    const result = executed.result;
    assert.ok(result);
    assert.equal(result.kind, 'signal_triage');
    assert.equal(result.outcome, 'triage_started');
    assert.equal('taskId' in result ? result.taskId : undefined, 'task_1');
    assert.deepEqual(triage.calls, [
      { signalId: 'external_signal_pr-42', requestKey: run.id },
    ]);
    // Re-executing a terminal run must not start a second triage.
    await lifecycle.executeRun('owner_v1', run.id);
    assert.equal(triage.calls.length, 1);
  });

  void it('skips a signal that resolved or was superseded before execution', async () => {
    const { lifecycle, signals, created, triage } = await harness();
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await signals.upsert(
      signal({ key: 'pr-1', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    await signals.upsert(
      signal({ key: 'pr-2', observedAt: '2026-09-05T10:02:00.000Z' }),
    );
    const runs = await lifecycle.materializeSignalOccurrences(approved);
    assert.equal(runs.length, 2);

    await signals.upsert(
      signal({
        key: 'pr-1',
        status: 'resolved',
        observedAt: '2026-09-05T10:03:00.000Z',
      }),
    );
    await signals.upsert(
      signal({
        key: 'pr-2',
        version: 2,
        observedAt: '2026-09-05T10:04:00.000Z',
      }),
    );
    const [resolvedRun, supersededRun] = runs;
    assert.ok(resolvedRun && supersededRun);
    const first = await lifecycle.executeRun('owner_v1', resolvedRun.id);
    const second = await lifecycle.executeRun('owner_v1', supersededRun.id);
    const firstResult = first.result;
    const secondResult = second.result;
    assert.ok(firstResult && 'skipReason' in firstResult);
    assert.ok(secondResult && 'skipReason' in secondResult);
    assert.equal(firstResult.skipReason, 'resolved');
    assert.equal(secondResult.skipReason, 'superseded');
    assert.equal(triage.calls.length, 0);
  });

  void it('never materializes a signal outside the approved trigger scope', async () => {
    const { lifecycle, signals, created } = await harness();
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await signals.upsert(
      signal({
        key: 'other-project',
        projectId: 'project_beta',
        observedAt: '2026-09-05T10:01:00.000Z',
      }),
    );
    await signals.upsert(
      signal({
        key: 'wrong-category',
        category: 'mentioned',
        observedAt: '2026-09-05T10:02:00.000Z',
      }),
    );
    assert.deepEqual(
      await lifecycle.materializeSignalOccurrences(approved),
      [],
    );
  });

  void it('fails a run closed when the signal leaves the approved scope after materialization', async () => {
    const { lifecycle, signals, created, triage } = await harness();
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await signals.upsert(
      signal({ key: 'pr-42', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    const [run] = await lifecycle.materializeSignalOccurrences(approved);
    assert.ok(run);
    await signals.upsert(
      signal({
        key: 'pr-42',
        version: 2,
        category: 'mentioned',
        observedAt: '2026-09-05T10:02:00.000Z',
      }),
    );
    const executed = await lifecycle.executeRun('owner_v1', run.id);
    assert.equal(executed.status, 'failed');
    assert.equal(executed.failure?.code, 'routine_signal_scope_changed');
    assert.equal(triage.calls.length, 0);
  });

  void it('defers occurrences past the daily budget and keeps them for the next day', async () => {
    const { lifecycle, signals, created, clock } = await harness({
      proposal: proposal({ maxOccurrencesPerDay: 1 }),
    });
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await signals.upsert(
      signal({ key: 'pr-1', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    await signals.upsert(
      signal({ key: 'pr-2', observedAt: '2026-09-05T10:02:00.000Z' }),
    );
    assert.equal(
      (await lifecycle.materializeSignalOccurrences(approved)).length,
      1,
    );
    assert.deepEqual(
      await lifecycle.materializeSignalOccurrences(approved),
      [],
    );
    clock.now = new Date('2026-09-06T10:00:00.000Z');
    const nextDay = await lifecycle.materializeSignalOccurrences(approved);
    assert.equal(nextDay.length, 1);
    assert.equal(nextDay[0]?.occurrenceKey, 'signal:external_signal_pr-2:1');
  });

  void it('expires the routine when the total budget or the expiry is reached', async () => {
    const budget = await harness({
      proposal: proposal({ maxTotalOccurrences: 1 }),
    });
    const approvedBudget = await budget.lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: budget.created.id,
      decision: 'approved',
    });
    await budget.signals.upsert(
      signal({ key: 'pr-1', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    await budget.signals.upsert(
      signal({ key: 'pr-2', observedAt: '2026-09-05T10:02:00.000Z' }),
    );
    assert.equal(
      (await budget.lifecycle.materializeSignalOccurrences(approvedBudget))
        .length,
      1,
    );
    assert.deepEqual(
      await budget.lifecycle.materializeSignalOccurrences(approvedBudget),
      [],
    );
    const exhausted = await budget.lifecycle.get('owner_v1', budget.created.id);
    assert.equal(exhausted.status, 'expired');
    assert.equal(exhausted.expiryReason, 'budget_exhausted');

    const expiring = await harness({
      proposal: proposal({ expiresAt: '2026-09-05T12:00:00.000Z' }),
    });
    const approvedExpiring = await expiring.lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: expiring.created.id,
      decision: 'approved',
    });
    await expiring.signals.upsert(
      signal({ key: 'pr-9', observedAt: '2026-09-05T13:00:00.000Z' }),
    );
    expiring.clock.now = new Date('2026-09-05T12:00:01.000Z');
    assert.deepEqual(
      await expiring.lifecycle.materializeSignalOccurrences(approvedExpiring),
      [],
    );
    const lapsed = await expiring.lifecycle.get(
      'owner_v1',
      expiring.created.id,
    );
    assert.equal(lapsed.status, 'expired');
    assert.equal(lapsed.expiryReason, 'expiry_reached');
    assert.equal(
      lapsed.events.at(-1)?.type,
      'routine_expired',
      'expiry must be recorded as an ordered event',
    );
  });

  void it('materializes nothing while paused and refuses an on-demand run', async () => {
    const { lifecycle, signals, created } = await harness();
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    await assert.rejects(
      lifecycle.runNow({
        principalId: 'owner_v1',
        routineId: created.id,
        requestKey: 'manual-1',
      }),
      /event-triggered routine runs only when a matching signal arrives/u,
    );
    const paused = await lifecycle.pause('owner_v1', created.id);
    await signals.upsert(
      signal({ key: 'pr-42', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    assert.deepEqual(await lifecycle.materializeSignalOccurrences(paused), []);
    const resumed = await lifecycle.resume('owner_v1', created.id);
    assert.equal(resumed.nextRunAt, undefined);
    assert.equal(
      (await lifecycle.materializeSignalOccurrences(approved)).length,
      1,
    );
  });

  void it('discovers, materializes, and executes occurrences from durable state alone', async () => {
    const { lifecycle, signals, created, store, triage, clock } =
      await harness();
    await lifecycle.decideApproval({
      principalId: 'owner_v1',
      routineId: created.id,
      decision: 'approved',
    });
    const worker = createRoutineWorker({
      workerId: 'routine_worker_test',
      store,
      leases: new InMemoryWorkLeaseStore(),
      lifecycle,
      concurrency: 4,
      pollIntervalMs: 10,
      leaseMs: 1_000,
      clock: () => clock.now,
      createToken: () => 'routine_worker_token',
    });

    // A quiet poll must report no progress so the loop sleeps instead of
    // spinning on an active event-triggered routine.
    assert.equal(await worker.runOnce(), 0);

    await signals.upsert(
      signal({ key: 'pr-42', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    assert.equal(
      await worker.runOnce(),
      2,
      'one materialization, one execution',
    );
    assert.equal(await worker.runOnce(), 0);
    assert.equal(triage.calls.length, 1);

    const runs = await lifecycle.listRuns('owner_v1', created.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, 'succeeded');
  });

  void it('round-robins event routines beyond concurrency and a transient failure', async () => {
    const { lifecycle, signals, created, store, clock } = await harness();
    const routines = [
      created,
      await lifecycle.create({
        ...proposal(),
        principalId: 'owner_v1',
        requestKey: 'triage-routine-2',
      }),
      await lifecycle.create({
        ...proposal(),
        principalId: 'owner_v1',
        requestKey: 'triage-routine-3',
      }),
    ];
    for (const routine of routines) {
      await lifecycle.decideApproval({
        principalId: 'owner_v1',
        routineId: routine.id,
        decision: 'approved',
      });
    }
    await signals.upsert(
      signal({ key: 'pr-fairness', observedAt: '2026-09-05T10:01:00.000Z' }),
    );
    const ordered = [...routines].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
    const visited: string[] = [];
    let failFirst = true;
    const workerLifecycle = {
      ...lifecycle,
      materializeSignalOccurrences: async (
        routine: (typeof routines)[number],
      ) => {
        visited.push(routine.id);
        if (failFirst && routine.id === ordered[0]?.id) {
          failFirst = false;
          throw new Error('transient signal-store failure');
        }
        return lifecycle.materializeSignalOccurrences(routine);
      },
    };
    const worker = createRoutineWorker({
      workerId: 'routine_worker_fairness',
      store,
      leases: new InMemoryWorkLeaseStore(),
      lifecycle: workerLifecycle,
      concurrency: 1,
      pollIntervalMs: 10,
      leaseMs: 1_000,
      clock: () => clock.now,
      createToken: () => 'routine_worker_fairness_token',
    });

    await assert.rejects(worker.runOnce(), /transient signal-store failure/u);
    assert.equal(await worker.runOnce(), 2);
    assert.equal(await worker.runOnce(), 2);
    assert.equal(await worker.runOnce(), 2);
    assert.deepEqual(visited, [
      ordered[0]?.id,
      ordered[1]?.id,
      ordered[2]?.id,
      ordered[0]?.id,
    ]);
    for (const routine of routines) {
      const runs = await lifecycle.listRuns('owner_v1', routine.id);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.status, 'succeeded');
    }
  });

  void it('rejects a proposal whose trigger and action disagree', async () => {
    const { lifecycle } = await harness();
    await assert.rejects(
      lifecycle.create({
        principalId: 'owner_v1',
        requestKey: 'mismatched',
        title: 'Mismatched',
        trigger: {
          kind: 'schedule',
          schedule: { kind: 'interval', minutes: 15 },
        },
        action: {
          kind: 'signal_triage',
          response: 'investigate_and_propose',
          disclosure: 'minimized_signal_evidence',
        },
      } as never),
    );
  });
});
