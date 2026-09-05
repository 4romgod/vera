import type {
  ExternalSignalCategory,
  ExternalSignalObservation,
} from '../../domain/external-awareness/external-signal.ts';
import type { RoutineAction } from '../../domain/routines/routine.ts';
import type { ExternalSignal } from '../../domain/external-awareness/external-signal.ts';

export type IntegrationAwarenessAction = Extract<
  RoutineAction,
  { kind: 'integration_awareness' }
>;

export type ExternalAwarenessOperations = {
  get(principalId: string, signalId: string): Promise<ExternalSignal>;
  list(principalId: string, limit?: number): Promise<ExternalSignal[]>;
  listByRoutine(
    principalId: string,
    routineId: string,
    limit?: number,
  ): Promise<ExternalSignal[]>;
  freeze(input: {
    principalId: string;
    integrationId: 'github';
    projectId: string;
    categories: ExternalSignalCategory[];
  }): Promise<IntegrationAwarenessAction>;
  execute(input: {
    principalId: string;
    routineId: string;
    action: IntegrationAwarenessAction;
    observedAt: string;
  }): Promise<{
    observations: ExternalSignalObservation[];
    created: number;
    changed: number;
    resolved: number;
  }>;
};
