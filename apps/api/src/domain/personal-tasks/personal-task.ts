import { z } from 'zod';

const PersonalTaskStatusSchema = z.enum(['open', 'completed']);
const PersonalTaskIdSchema = z
  .string()
  .regex(/^personal_task_[a-z0-9][a-z0-9_-]*$/u);

export const PersonalTaskSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: PersonalTaskIdSchema,
    principalId: z.string().min(1),
    title: z.string().trim().min(1).max(500),
    notes: z.string().trim().min(1).max(5_000).optional(),
    dueAt: z.iso.datetime().optional(),
    status: PersonalTaskStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    creationInvocationId: z.string().startsWith('invocation_'),
    lastMutation: z
      .object({
        invocationId: z.string().startsWith('invocation_'),
        orderKey: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const PersonalTaskResourceSchema = PersonalTaskSchema.omit({
  principalId: true,
  creationInvocationId: true,
  lastMutation: true,
});

export const PersonalTaskActionArgumentsSchema = z.discriminatedUnion(
  'action',
  [
    z
      .object({
        action: z.literal('create'),
        title: z.string().trim().min(1).max(500),
        notes: z.string().trim().min(1).max(5_000).optional(),
        dueAt: z.iso.datetime().optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('list'),
        status: z.enum(['all', 'open', 'completed']).optional(),
        limit: z.number().int().positive().max(100).optional(),
      })
      .strict(),
    z
      .object({
        action: z.enum(['complete', 'reopen']),
        taskId: PersonalTaskIdSchema,
      })
      .strict(),
  ],
);

export const PersonalTaskResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.enum(['create', 'list', 'complete', 'reopen']),
    summary: z.string().trim().min(1).max(1_000),
    tasks: z.array(PersonalTaskResourceSchema).max(100),
  })
  .strict();

export type PersonalTask = z.infer<typeof PersonalTaskSchema>;
export type PersonalTaskResource = z.infer<typeof PersonalTaskResourceSchema>;
export type PersonalTaskActionArguments = z.infer<
  typeof PersonalTaskActionArgumentsSchema
>;
export type PersonalTaskResult = z.infer<typeof PersonalTaskResultSchema>;

export function personalTaskResource(task: PersonalTask): PersonalTaskResource {
  const {
    principalId: ignoredPrincipal,
    creationInvocationId: ignoredCreation,
    lastMutation: ignoredMutation,
    ...resource
  } = task;
  void ignoredPrincipal;
  void ignoredCreation;
  void ignoredMutation;
  return PersonalTaskResourceSchema.parse(resource);
}
