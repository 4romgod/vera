import type { Routine, RoutineRun } from '../../domain/routines/routine.ts';

export type RoutineStore = {
  create(routine: Routine): Promise<{ created: boolean; routine: Routine }>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<Routine | null>;
  findById(principalId: string, routineId: string): Promise<Routine | null>;
  list(principalId: string, limit: number): Promise<Routine[]>;
  replace(routine: Routine, expectedVersion: number): Promise<boolean>;
  findDue(now: string, limit: number): Promise<Routine[]>;
  createRun(run: RoutineRun): Promise<{ created: boolean; run: RoutineRun }>;
  findRunById(principalId: string, runId: string): Promise<RoutineRun | null>;
  listRuns(
    principalId: string,
    routineId: string,
    limit: number,
  ): Promise<RoutineRun[]>;
  replaceRun(run: RoutineRun, expectedVersion: number): Promise<boolean>;
  findRunnable(limit: number): Promise<RoutineRun[]>;
  listAttentionRuns(principalId: string, limit: number): Promise<RoutineRun[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
