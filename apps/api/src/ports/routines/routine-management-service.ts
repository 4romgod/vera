import type {
  RoutineManagementArguments,
  RoutineManagementResult,
} from '../../domain/routines/routine.ts';

export type RoutineManagementService = {
  invoke(input: {
    principalId: string;
    requestKey: string;
    arguments: RoutineManagementArguments;
  }): Promise<RoutineManagementResult>;
};
