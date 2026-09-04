import type {
  Routine,
  RoutineRun,
} from '../../../../domain/routines/routine.ts';
import type { RoutineStore } from '../../../../ports/persistence/routine-store.ts';

export class InMemoryRoutineStore implements RoutineStore {
  private readonly routines = new Map<string, Routine>();
  private readonly routineIdsByRequest = new Map<string, string>();
  private readonly runs = new Map<string, RoutineRun>();
  private readonly runIdsByOccurrence = new Map<string, string>();

  public create(routine: Routine) {
    const key = `${routine.principalId}\u0000${routine.requestKey}`;
    const id = this.routineIdsByRequest.get(key);
    if (id !== undefined) {
      const existing = this.routines.get(id);
      if (existing === undefined) throw new Error('Routine index is invalid.');
      return Promise.resolve({
        created: false,
        routine: structuredClone(existing),
      });
    }
    this.routineIdsByRequest.set(key, routine.id);
    this.routines.set(routine.id, structuredClone(routine));
    return Promise.resolve({
      created: true,
      routine: structuredClone(routine),
    });
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const id = this.routineIdsByRequest.get(
      `${principalId}\u0000${requestKey}`,
    );
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public findById(principalId: string, routineId: string) {
    const routine = this.routines.get(routineId);
    return Promise.resolve(
      routine?.principalId === principalId ? structuredClone(routine) : null,
    );
  }

  public list(principalId: string, limit: number) {
    return Promise.resolve(
      [...this.routines.values()]
        .filter((routine) => routine.principalId === principalId)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, limit)
        .map((routine) => structuredClone(routine)),
    );
  }

  public replace(routine: Routine, expectedVersion: number) {
    const current = this.routines.get(routine.id);
    if (current?.version !== expectedVersion) return Promise.resolve(false);
    this.routines.set(routine.id, structuredClone(routine));
    return Promise.resolve(true);
  }

  public findDue(now: string, limit: number) {
    return Promise.resolve(
      [...this.routines.values()]
        .filter(
          (routine) =>
            routine.status === 'active' &&
            routine.nextRunAt !== undefined &&
            routine.nextRunAt <= now,
        )
        .sort((left, right) =>
          (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? ''),
        )
        .slice(0, limit)
        .map((routine) => structuredClone(routine)),
    );
  }

  public createRun(run: RoutineRun) {
    const key = `${run.routineId}\u0000${run.occurrenceKey}`;
    const id = this.runIdsByOccurrence.get(key);
    if (id !== undefined) {
      const existing = this.runs.get(id);
      if (existing === undefined)
        throw new Error('Routine-run index is invalid.');
      return Promise.resolve({
        created: false,
        run: structuredClone(existing),
      });
    }
    this.runIdsByOccurrence.set(key, run.id);
    this.runs.set(run.id, structuredClone(run));
    return Promise.resolve({ created: true, run: structuredClone(run) });
  }

  public findRunById(principalId: string, runId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(
      run?.principalId === principalId ? structuredClone(run) : null,
    );
  }

  public listRuns(principalId: string, routineId: string, limit: number) {
    return Promise.resolve(
      [...this.runs.values()]
        .filter(
          (run) =>
            run.principalId === principalId && run.routineId === routineId,
        )
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, limit)
        .map((run) => structuredClone(run)),
    );
  }

  public replaceRun(run: RoutineRun, expectedVersion: number) {
    const current = this.runs.get(run.id);
    if (current?.version !== expectedVersion) return Promise.resolve(false);
    this.runs.set(run.id, structuredClone(run));
    return Promise.resolve(true);
  }

  public findRunnable(limit: number) {
    return Promise.resolve(
      [...this.runs.values()]
        .filter((run) => run.status === 'queued' || run.status === 'executing')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((run) => structuredClone(run)),
    );
  }

  public listAttentionRuns(principalId: string, limit: number) {
    return Promise.resolve(
      [...this.runs.values()]
        .filter(
          (run) =>
            run.principalId === principalId &&
            (run.status === 'failed' ||
              run.result?.outcome === 'attention_required'),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map((run) => structuredClone(run)),
    );
  }

  public checkReadiness() {
    return Promise.resolve();
  }
  public close() {
    this.routines.clear();
    this.routineIdsByRequest.clear();
    this.runs.clear();
    this.runIdsByOccurrence.clear();
    return Promise.resolve();
  }
}
