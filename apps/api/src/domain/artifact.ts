import { z } from 'zod';

import { DevelopmentPlanSchema } from './development-plan.ts';
import { CapabilityDestinationSchema } from './capability-destination.ts';
import { SoftwareChangeSchema } from './software-change.ts';

const ArtifactProducerSchema = z
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
  .strict();

const ArtifactIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith('artifact_'),
    version: z.literal(1),
    principalId: z.string().min(1),
    taskId: z.string().startsWith('task_'),
    runId: z.string().startsWith('run_'),
    invocationId: z.string().startsWith('invocation_'),
    projectId: z.string().startsWith('project_'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    producer: ArtifactProducerSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export const ImplementationPlanArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('implementation_plan'),
  mediaType: z.literal('application/vnd.vera.implementation-plan+json'),
  content: DevelopmentPlanSchema,
}).strict();

export const SoftwareChangeArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('software_change'),
  mediaType: z.literal('application/vnd.vera.software-change+json'),
  content: SoftwareChangeSchema,
}).strict();

export const ArtifactSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactSchema,
  SoftwareChangeArtifactSchema,
]);

const ArtifactReferenceBaseSchema = ArtifactIdentitySchema.pick({
  id: true,
  version: true,
  sha256: true,
  byteLength: true,
});

export const ImplementationPlanArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('implementation_plan'),
    mediaType: z.literal('application/vnd.vera.implementation-plan+json'),
  }).strict();

export const SoftwareChangeArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('software_change'),
    mediaType: z.literal('application/vnd.vera.software-change+json'),
  }).strict();

export const ArtifactReferenceSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactReferenceSchema,
  SoftwareChangeArtifactReferenceSchema,
]);

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
