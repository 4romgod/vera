import { z } from 'zod';

import { DecisionResultSchema } from '../domain/execution-decision.ts';
import {
  ApprovalSchema,
  CapabilityInvocationSchema,
  RunStatusSchema,
  TaskFailureSchema,
  TaskOutputSchema,
  type TaskAggregate,
} from '../domain/task-aggregate.ts';

export const ScratchpadProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    aggregateVersion: z.number().int().positive(),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    message: z.string().min(1),
    status: RunStatusSchema,
    decision: DecisionResultSchema.optional(),
    approval: ApprovalSchema.optional(),
    invocation: CapabilityInvocationSchema.optional(),
    output: TaskOutputSchema.optional(),
    failure: TaskFailureSchema.optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type ScratchpadProjection = z.infer<typeof ScratchpadProjectionSchema>;

export type Scratchpad = {
  put(projection: ScratchpadProjection): Promise<void>;
  get(runId: string): Promise<ScratchpadProjection | null>;
  delete(runId: string): Promise<void>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};

export function projectAggregate(
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
