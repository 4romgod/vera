import type { TaskAggregate } from '../../domain/tasks/task-aggregate.ts';

export type CreateAggregateResult =
  | { created: true; aggregate: TaskAggregate }
  | { created: false; aggregate: TaskAggregate };

export type ExecutionStore = {
  create(aggregate: TaskAggregate): Promise<CreateAggregateResult>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<TaskAggregate | null>;
  findByTaskId(
    principalId: string,
    taskId: string,
  ): Promise<TaskAggregate | null>;
  findByRunId(
    principalId: string,
    runId: string,
  ): Promise<TaskAggregate | null>;
  findByApprovalId(
    principalId: string,
    approvalId: string,
  ): Promise<TaskAggregate | null>;
  replace(aggregate: TaskAggregate, expectedVersion: number): Promise<boolean>;
  findDispatchable(limit: number): Promise<TaskAggregate[]>;
  findRecoverable(): Promise<TaskAggregate[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
