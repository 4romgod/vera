import { z } from 'zod';

import { DevelopmentPlanSchema } from './development-plan.ts';
import { CapabilityDestinationSchema } from './capability-destination.ts';

export const ArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('artifact_'),
    version: z.literal(1),
    principalId: z.string().min(1),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    invocationId: z.string().startsWith('invocation_'),
    projectId: z.string().startsWith('project_'),
    type: z.literal('implementation_plan'),
    mediaType: z.literal('application/vnd.vera.implementation-plan+json'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    producer: z
      .object({
        destination: CapabilityDestinationSchema.optional(),
        provider: z.string(),
        model: z.string(),
        durationMs: z.number().nonnegative(),
        usage: z
          .object({
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    content: DevelopmentPlanSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export const ArtifactReferenceSchema = ArtifactSchema.pick({
  id: true,
  version: true,
  type: true,
  mediaType: true,
  sha256: true,
  byteLength: true,
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
