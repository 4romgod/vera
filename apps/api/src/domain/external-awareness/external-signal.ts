import { z } from 'zod';

export const ExternalSignalCategorySchema = z.enum([
  'review_requested',
  'mentioned',
  'assigned',
  'failed_check',
]);

export const ExternalSignalObservationSchema = z
  .object({
    externalKey: z.string().trim().min(1).max(500),
    category: ExternalSignalCategorySchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000),
    url: z.url(),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export const ExternalSignalSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    id: z.string().startsWith('external_signal_'),
    principalId: z.string().min(1),
    routineId: z.string().startsWith('routine_'),
    integrationId: z.string().min(1).max(100),
    connectionId: z.string().startsWith('connection_'),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().trim().min(1).max(200),
      })
      .strict(),
    repository: z
      .object({
        provider: z.literal('github'),
        owner: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(100),
      })
      .strict(),
    externalKey: z.string().trim().min(1).max(500),
    category: ExternalSignalCategorySchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000),
    url: z.url(),
    occurredAt: z.iso.datetime(),
    status: z.enum(['active', 'resolved']),
    firstObservedAt: z.iso.datetime(),
    lastObservedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((signal, context) => {
    if ((signal.status === 'resolved') !== (signal.resolvedAt !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['resolvedAt'],
        message: 'Only resolved signals require a resolution time.',
      });
    }
  });

export type ExternalSignalCategory = z.infer<
  typeof ExternalSignalCategorySchema
>;
export type ExternalSignalObservation = z.infer<
  typeof ExternalSignalObservationSchema
>;
export type ExternalSignal = z.infer<typeof ExternalSignalSchema>;

export const ExternalSignalJsonSchema = z.toJSONSchema(ExternalSignalSchema, {
  target: 'draft-7',
  unrepresentable: 'throw',
});
