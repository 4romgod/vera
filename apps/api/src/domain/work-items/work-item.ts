import { z } from 'zod';

const ProjectIdentitySchema = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();

const WorkItemTargetSchema = z
  .object({ number: z.number().int().positive() })
  .strict();

export const WorkItemActionArgumentsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      objective: z.string().trim().min(1).max(10_000),
      project: ProjectIdentitySchema,
      issue: z
        .object({
          title: z.string().trim().min(1).max(256),
          body: z.string().max(50_000).default(''),
          labels: z
            .array(z.string().trim().min(1).max(100))
            .max(20)
            .default([]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list'),
      objective: z.string().trim().min(1).max(10_000),
      project: ProjectIdentitySchema,
      state: z.enum(['open', 'closed', 'all']).default('open'),
      limit: z.number().int().positive().max(50).default(20),
    })
    .strict(),
  z
    .object({
      action: z.literal('inspect'),
      objective: z.string().trim().min(1).max(10_000),
      project: ProjectIdentitySchema,
      issue: WorkItemTargetSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('comment'),
      objective: z.string().trim().min(1).max(10_000),
      project: ProjectIdentitySchema,
      issue: WorkItemTargetSchema,
      body: z.string().trim().min(1).max(50_000),
    })
    .strict(),
  z
    .object({
      action: z.enum(['close', 'reopen']),
      objective: z.string().trim().min(1).max(10_000),
      project: ProjectIdentitySchema,
      issue: WorkItemTargetSchema,
    })
    .strict(),
]);

export const WorkItemSchema = z
  .object({
    provider: z.literal('github'),
    repository: z
      .object({ owner: z.string().min(1), name: z.string().min(1) })
      .strict(),
    number: z.number().int().positive(),
    title: z.string().min(1),
    body: z.string(),
    state: z.enum(['open', 'closed']),
    url: z.url(),
    labels: z.array(z.string()),
    author: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const WorkItemResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.enum(['create', 'list', 'inspect', 'comment', 'close', 'reopen']),
    summary: z.string().trim().min(1).max(2_000),
    connectionId: z.string().startsWith('connection_'),
    items: z.array(WorkItemSchema).max(50),
  })
  .strict();

export type WorkItemActionArguments = z.infer<
  typeof WorkItemActionArgumentsSchema
>;
export type WorkItem = z.infer<typeof WorkItemSchema>;
export type WorkItemResult = z.infer<typeof WorkItemResultSchema>;
