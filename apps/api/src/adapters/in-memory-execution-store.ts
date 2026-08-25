import type {
  CreateAggregateResult,
  ExecutionStore,
} from '../ports/execution-store.ts';
import type { TaskAggregate } from '../domain/task-aggregate.ts';

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly byTaskId = new Map<string, TaskAggregate>();
  private readonly taskIdByRequestKey = new Map<string, string>();

  public create(aggregate: TaskAggregate): Promise<CreateAggregateResult> {
    const requestIdentity = this.requestIdentity(
      aggregate.task.principalId,
      aggregate.task.requestKey,
    );
    const existingTaskId = this.taskIdByRequestKey.get(requestIdentity);
    if (existingTaskId !== undefined) {
      const existing = this.byTaskId.get(existingTaskId);
      if (existing === undefined) {
        throw new Error('In-memory request index is inconsistent.');
      }
      return Promise.resolve({
        created: false,
        aggregate: structuredClone(existing),
      });
    }

    this.taskIdByRequestKey.set(requestIdentity, aggregate.task.id);
    this.byTaskId.set(aggregate.task.id, structuredClone(aggregate));
    return Promise.resolve({
      created: true,
      aggregate: structuredClone(aggregate),
    });
  }

  public findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<TaskAggregate | null> {
    const taskId = this.taskIdByRequestKey.get(
      this.requestIdentity(principalId, requestKey),
    );
    return Promise.resolve(taskId === undefined ? null : this.clone(taskId));
  }

  public findByTaskId(
    principalId: string,
    taskId: string,
  ): Promise<TaskAggregate | null> {
    return Promise.resolve(this.cloneOwned(principalId, taskId));
  }

  public findByRunId(
    principalId: string,
    runId: string,
  ): Promise<TaskAggregate | null> {
    return Promise.resolve(
      this.find(
        (aggregate) =>
          aggregate.task.principalId === principalId &&
          aggregate.run.id === runId,
      ),
    );
  }

  public findByApprovalId(
    principalId: string,
    approvalId: string,
  ): Promise<TaskAggregate | null> {
    return Promise.resolve(
      this.find(
        (aggregate) =>
          aggregate.task.principalId === principalId &&
          aggregate.run.approval?.id === approvalId,
      ),
    );
  }

  public replace(
    aggregate: TaskAggregate,
    expectedVersion: number,
  ): Promise<boolean> {
    const existing = this.byTaskId.get(aggregate.task.id);
    if (existing?.version !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.byTaskId.set(aggregate.task.id, structuredClone(aggregate));
    return Promise.resolve(true);
  }

  public findRecoverable(): Promise<TaskAggregate[]> {
    return Promise.resolve(
      [...this.byTaskId.values()]
        .filter(
          (aggregate) =>
            aggregate.run.status === 'deciding' ||
            aggregate.run.status === 'executing' ||
            aggregate.run.status === 'awaiting_approval' ||
            aggregate.run.status === 'cancellation_requested',
        )
        .map((aggregate) => structuredClone(aggregate)),
    );
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  private clone(taskId: string): TaskAggregate | null {
    const aggregate = this.byTaskId.get(taskId);
    return aggregate === undefined ? null : structuredClone(aggregate);
  }

  private cloneOwned(
    principalId: string,
    taskId: string,
  ): TaskAggregate | null {
    const aggregate = this.clone(taskId);
    return aggregate?.task.principalId === principalId ? aggregate : null;
  }

  private requestIdentity(principalId: string, requestKey: string): string {
    return `${principalId}\u0000${requestKey}`;
  }

  private find(
    predicate: (aggregate: TaskAggregate) => boolean,
  ): TaskAggregate | null {
    const aggregate = [...this.byTaskId.values()].find(predicate);
    return aggregate === undefined ? null : structuredClone(aggregate);
  }
}
