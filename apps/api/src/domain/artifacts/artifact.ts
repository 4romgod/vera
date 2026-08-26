import { z } from 'zod';

import { DevelopmentPlanSchema } from '../plans/development-plan.ts';
import { CapabilityDestinationSchema } from '../capabilities/capability-destination.ts';
import { SoftwareChangeSchema } from '../changes/software-change.ts';
import { ResearchReportSchema } from '../research/research-report.ts';
import { PersonalTaskResultSchema } from '../personal-tasks/personal-task.ts';

export const ArtifactLineageReferenceSchema = z
  .object({
    id: z.string().startsWith('artifact_'),
    version: z.literal(1),
    type: z.enum([
      'implementation_plan',
      'software_change',
      'research_report',
      'personal_task_result',
    ]),
    mediaType: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

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
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    producer: ArtifactProducerSchema,
    inputs: z.array(ArtifactLineageReferenceSchema).max(2).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const ImplementationPlanArtifactSchema = ArtifactIdentitySchema.extend({
  projectId: z.string().startsWith('project_'),
  type: z.literal('implementation_plan'),
  mediaType: z.literal('application/vnd.vera.implementation-plan+json'),
  content: DevelopmentPlanSchema,
}).strict();

export const SoftwareChangeArtifactSchema = ArtifactIdentitySchema.extend({
  projectId: z.string().startsWith('project_'),
  type: z.literal('software_change'),
  mediaType: z.literal('application/vnd.vera.software-change+json'),
  content: SoftwareChangeSchema,
}).strict();

export const ResearchReportArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('research_report'),
  mediaType: z.literal('application/vnd.vera.research-report+json'),
  content: ResearchReportSchema,
}).strict();

export const PersonalTaskResultArtifactSchema = ArtifactIdentitySchema.extend({
  type: z.literal('personal_task_result'),
  mediaType: z.literal('application/vnd.vera.personal-task-result+json'),
  content: PersonalTaskResultSchema,
}).strict();

export const ArtifactSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactSchema,
  SoftwareChangeArtifactSchema,
  ResearchReportArtifactSchema,
  PersonalTaskResultArtifactSchema,
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

export const ResearchReportArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('research_report'),
    mediaType: z.literal('application/vnd.vera.research-report+json'),
  }).strict();

export const PersonalTaskResultArtifactReferenceSchema =
  ArtifactReferenceBaseSchema.extend({
    type: z.literal('personal_task_result'),
    mediaType: z.literal('application/vnd.vera.personal-task-result+json'),
  }).strict();

export const ArtifactReferenceSchema = z.discriminatedUnion('type', [
  ImplementationPlanArtifactReferenceSchema,
  SoftwareChangeArtifactReferenceSchema,
  ResearchReportArtifactReferenceSchema,
  PersonalTaskResultArtifactReferenceSchema,
]);

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
