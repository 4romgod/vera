import type {
  CreateAggregateResult,
  ExecutionStore,
} from '../ports/execution-store.ts';
import type { TaskAggregate } from '../domain/task-aggregate.ts';

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly byTaskId = new Map<string, TaskAggregate>();
  private readonly taskIdByRequestKey = new Map<string, string>();

  public create(aggregate: TaskAggregate): Promise<CreateAggregateResult> {
    const existingTaskId = this.taskIdByRequestKey.get(
      aggregate.task.requestKey,
    );
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

    this.taskIdByRequestKey.set(aggregate.task.requestKey, aggregate.task.id);
    this.byTaskId.set(aggregate.task.id, structuredClone(aggregate));
    return Promise.resolve({
      created: true,
      aggregate: structuredClone(aggregate),
    });
  }

  public findByRequestKey(requestKey: string): Promise<TaskAggregate | null> {
    const taskId = this.taskIdByRequestKey.get(requestKey);
    return Promise.resolve(taskId === undefined ? null : this.clone(taskId));
  }

  public findByTaskId(taskId: string): Promise<TaskAggregate | null> {
    return Promise.resolve(this.clone(taskId));
  }

  public findByRunId(runId: string): Promise<TaskAggregate | null> {
    return Promise.resolve(
      this.find((aggregate) => aggregate.run.id === runId),
    );
  }

  public findByApprovalId(approvalId: string): Promise<TaskAggregate | null> {
    return Promise.resolve(
      this.find((aggregate) => aggregate.run.approval?.id === approvalId),
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
            aggregate.run.status === 'awaiting_approval',
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

  private find(
    predicate: (aggregate: TaskAggregate) => boolean,
  ): TaskAggregate | null {
    const aggregate = [...this.byTaskId.values()].find(predicate);
    return aggregate === undefined ? null : structuredClone(aggregate);
  }
}
