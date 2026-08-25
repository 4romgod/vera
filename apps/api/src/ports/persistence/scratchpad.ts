import { z } from 'zod';

import { DecisionResultSchema } from '../../domain/model/execution-decision.ts';
import {
  ApprovalSchema,
  CapabilityInvocationSchema,
  RunStatusSchema,
  TaskFailureSchema,
  TaskOutputSchema,
} from '../../domain/tasks/task-aggregate.ts';

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
