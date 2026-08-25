import type { TaskAggregate } from '../../domain/tasks/task-aggregate.ts';
import type { ScratchpadProjection } from '../../ports/persistence/scratchpad.ts';

export function projectTaskScratchpad(
  aggregate: TaskAggregate,
): ScratchpadProjection {
  return {
    schemaVersion: 1,
    aggregateVersion: aggregate.version,
    taskId: aggregate.task.id,
    runId: aggregate.run.id,
    message: aggregate.task.message,
    status: aggregate.run.status,
    ...(aggregate.run.decision === undefined
      ? {}
      : { decision: aggregate.run.decision }),
    ...(aggregate.run.approval === undefined
      ? {}
      : { approval: aggregate.run.approval }),
    ...(aggregate.run.invocation === undefined
      ? {}
      : { invocation: aggregate.run.invocation }),
    ...(aggregate.run.output === undefined
      ? {}
      : { output: aggregate.run.output }),
    ...(aggregate.run.failure === undefined
      ? {}
      : { failure: aggregate.run.failure }),
    updatedAt: aggregate.run.updatedAt,
  };
}
