import type { TaskAggregate } from '../../domain/tasks/task-aggregate.ts';

// The narrow slice of ADR-0047 triage that event-triggered standing authority
// may start. Widening this port widens what a routine can do without an owner.
export type ExternalSignalTriageStarter = {
  handle(input: {
    principalId: string;
    signalId: string;
    requestKey: string;
    objective?: string;
  }): Promise<TaskAggregate>;
};
