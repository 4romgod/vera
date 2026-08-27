import { z } from 'zod';

import { ArtifactReferenceSchema } from '../artifacts/artifact.ts';
import {
  DevelopmentPlanningGoalStepSchema,
  GoalExecutionStepSchema,
  GoalStepSchema,
  PersonalReminderManagementGoalStepSchema,
  PersonalTaskManagementGoalStepSchema,
  MemoryManagementGoalStepSchema,
  SoftwareChangeGoalStepSchema,
  WebResearchGoalStepSchema,
  MachineInspectionGoalStepSchema,
  MachineServiceManagementGoalStepSchema,
} from './goal-plan.ts';
import type { CapabilityReference } from '../capabilities/capability-registry.ts';

const DecisionSummarySchema = z.string().trim().min(1).max(500);

export function nextAdaptiveGoalStepId(
  existingStepIds: readonly string[],
): string {
  const existing = new Set(existingStepIds);
  let sequence = existingStepIds.length + 1;
  while (existing.has(`step_${String(sequence)}`)) {
    sequence += 1;
  }
  return `step_${String(sequence)}`;
}

export const AdaptiveGoalRequirementSchema = z
  .object({
    id: z.string().regex(/^requirement_[a-z0-9_]+$/u),
    description: z.string().trim().min(1).max(1_000),
    capability: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    version: z.number().int().positive(),
    condition: z.union([
      z.object({ kind: z.literal('always') }).strict(),
      z
        .object({
          kind: z.literal('evidence_dependent'),
          description: z.string().trim().min(1).max(1_000),
        })
        .strict(),
    ]),
  })
  .strict();

const AdaptiveGoalRequirementResolutionSchema = z.union([
  z
    .object({
      requirementId: z.string().regex(/^requirement_[a-z0-9_]+$/u),
      status: z.literal('satisfied'),
      evidenceStepIds: z
        .array(z.string().regex(/^step_[a-z0-9_]+$/u))
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      requirementId: z.string().regex(/^requirement_[a-z0-9_]+$/u),
      status: z.literal('not_applicable'),
      reason: z.string().trim().min(1).max(1_000),
      evidenceStepIds: z
        .array(z.string().regex(/^step_[a-z0-9_]+$/u))
        .min(1)
        .max(3),
    })
    .strict(),
]);

export const AdaptiveGoalPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    objective: z.string().trim().min(1).max(10_000),
    summary: z.string().trim().min(1).max(1_000),
    completionCriteria: z.string().trim().min(1).max(2_000),
    requirements: z.array(AdaptiveGoalRequirementSchema).min(1).max(3),
    firstStep: GoalStepSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.firstStep.inputStepIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['firstStep', 'inputStepIds'],
        message: 'The first adaptive goal step cannot depend on prior output.',
      });
    }
    if (
      new Set(plan.requirements.map(({ id }) => id)).size !==
      plan.requirements.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requirements'],
        message: 'Adaptive goal requirement ids must be unique.',
      });
    }
    if (
      !plan.requirements.some(
        (requirement) =>
          requirement.condition.kind === 'always' &&
          requirement.capability === plan.firstStep.capability &&
          requirement.version === plan.firstStep.version,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstStep', 'capability'],
        message:
          'The first adaptive goal step must satisfy an unconditional requirement.',
      });
    }
  });

export const AdaptiveGoalContinuationProposalSchema = z.union([
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('continue_goal'),
      decisionSummary: DecisionSummarySchema,
      step: GoalStepSchema,
      evidenceStepIds: z
        .array(z.string().regex(/^step_[a-z0-9_]+$/u))
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('complete_goal'),
      decisionSummary: DecisionSummarySchema,
      message: z.string().trim().min(1).max(20_000),
      evidenceStepIds: z
        .array(z.string().regex(/^step_[a-z0-9_]+$/u))
        .min(1)
        .max(3),
      requirementResolutions: z
        .array(AdaptiveGoalRequirementResolutionSchema)
        .min(1)
        .max(3),
    })
    .strict(),
]);

export function createAdaptiveGoalContinuationProposalSchema(options: {
  enabledCapabilities: readonly CapabilityReference[];
  evidenceStepIds?: readonly string[];
  observations?: readonly {
    stepId: string;
    capability: CapabilityReference;
  }[];
  nextStepId?: string;
  requirements?: readonly z.infer<typeof AdaptiveGoalRequirementSchema>[];
}): z.ZodType<AdaptiveGoalContinuationProposal> {
  const evidenceStepIdSchema =
    options.evidenceStepIds !== undefined && options.evidenceStepIds.length > 0
      ? z.enum(options.evidenceStepIds as [string, ...string[]])
      : z.string().regex(/^step_[a-z0-9_]+$/u);
  const evidenceStepIdsSchema = z.array(evidenceStepIdSchema).min(1).max(3);
  const constrainStepId = <T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
  ): z.ZodType =>
    options.nextStepId === undefined
      ? schema
      : schema.extend({ id: z.literal(options.nextStepId) });
  const enabledSteps: z.ZodType[] = [
    ...(options.enabledCapabilities.some(
      ({ name, version }) => name === 'development_planning' && version === 1,
    )
      ? [constrainStepId(DevelopmentPlanningGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) => name === 'software_change' && version === 1,
    )
      ? [constrainStepId(SoftwareChangeGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) => name === 'web_research' && version === 1,
    )
      ? [constrainStepId(WebResearchGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) =>
        name === 'personal_task_management' && version === 1,
    )
      ? [constrainStepId(PersonalTaskManagementGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) =>
        name === 'personal_reminder_management' && version === 1,
    )
      ? [constrainStepId(PersonalReminderManagementGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) => name === 'memory_management' && version === 1,
    )
      ? [constrainStepId(MemoryManagementGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) => name === 'machine_inspection' && version === 1,
    )
      ? [constrainStepId(MachineInspectionGoalStepSchema)]
      : []),
    ...(options.enabledCapabilities.some(
      ({ name, version }) =>
        name === 'machine_service_management' && version === 1,
    )
      ? [constrainStepId(MachineServiceManagementGoalStepSchema)]
      : []),
  ];
  const requirementResolutionSchemas = options.requirements?.map(
    (requirement) => {
      const matchingEvidenceStepIds = options.observations
        ?.filter(
          (observation) =>
            observation.capability.name === requirement.capability &&
            observation.capability.version === requirement.version,
        )
        .map(({ stepId }) => stepId);
      const matchingEvidenceSchema =
        matchingEvidenceStepIds !== undefined &&
        matchingEvidenceStepIds.length > 0
          ? z
              .array(z.enum(matchingEvidenceStepIds as [string, ...string[]]))
              .min(1)
              .max(3)
          : evidenceStepIdsSchema;
      const satisfied = z
        .object({
          requirementId: z.literal(requirement.id),
          status: z.literal('satisfied'),
          evidenceStepIds: matchingEvidenceSchema,
        })
        .strict();
      if (matchingEvidenceStepIds?.length) return satisfied;
      return requirement.condition.kind === 'always'
        ? satisfied
        : z
            .object({
              requirementId: z.literal(requirement.id),
              status: z.literal('not_applicable'),
              reason: z.string().trim().min(1).max(1_000),
              evidenceStepIds: evidenceStepIdsSchema,
            })
            .strict();
    },
  );
  const completionAllowed =
    options.requirements?.every(
      (requirement) =>
        requirement.condition.kind === 'evidence_dependent' ||
        options.observations?.some(
          (observation) =>
            observation.capability.name === requirement.capability &&
            observation.capability.version === requirement.version,
        ),
    ) ?? true;
  const firstRequirementResolution = requirementResolutionSchemas?.[0];
  const requirementResolutionSchema = (firstRequirementResolution === undefined
    ? AdaptiveGoalRequirementResolutionSchema
    : requirementResolutionSchemas?.length === 1
      ? firstRequirementResolution
      : z.union(
          requirementResolutionSchemas as unknown as [
            z.ZodType,
            z.ZodType,
            ...z.ZodType[],
          ],
        )) as unknown as z.ZodType<
    z.infer<typeof AdaptiveGoalRequirementResolutionSchema>
  >;
  const complete = z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('complete_goal'),
      decisionSummary: DecisionSummarySchema,
      message: z.string().trim().min(1).max(20_000),
      evidenceStepIds: evidenceStepIdsSchema,
      requirementResolutions: z
        .array(requirementResolutionSchema)
        .min(1)
        .max(3),
    })
    .strict();
  const firstEnabledStep = enabledSteps[0];
  if (firstEnabledStep === undefined) return complete;
  const enabledStep =
    enabledSteps.length === 1
      ? firstEnabledStep
      : z.union(
          enabledSteps as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
        );
  const continuation = z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('continue_goal'),
      decisionSummary: DecisionSummarySchema,
      step: enabledStep,
      evidenceStepIds: evidenceStepIdsSchema,
    })
    .strict();
  return (
    completionAllowed ? z.union([continuation, complete]) : continuation
  ) as z.ZodType<AdaptiveGoalContinuationProposal>;
}

export const AdaptiveGoalContinuationDecisionSchema = z.union([
  z
    .object({
      kind: z.literal('continue_goal'),
      step: GoalStepSchema,
      evidenceStepIds: z
        .array(z.string().regex(/^step_[a-z0-9_]+$/u))
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal('complete_goal'),
      message: z.string().trim().min(1).max(20_000),
      evidenceStepIds: z
        .array(z.string().regex(/^step_[a-z0-9_]+$/u))
        .min(1)
        .max(3),
      requirementResolutions: z
        .array(AdaptiveGoalRequirementResolutionSchema)
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rejected'),
      code: z.enum([
        'invalid_model_output',
        'invalid_continuation',
        'unknown_capability',
        'budget_exhausted',
      ]),
      message: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

export const AdaptiveGoalContinuationResultSchema = z
  .object({
    decisionId: z.string().startsWith('decision_'),
    proposal: AdaptiveGoalContinuationProposalSchema.nullable(),
    decision: AdaptiveGoalContinuationDecisionSchema,
    model: z
      .object({
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
    decidedAt: z.iso.datetime(),
  })
  .strict();

export const AdaptiveGoalExecutionSchema = z
  .object({
    schemaVersion: z.literal(2),
    mode: z.literal('adaptive'),
    objective: z.string().trim().min(1).max(10_000),
    summary: z.string().trim().min(1).max(1_000),
    completionCriteria: z.string().trim().min(1).max(2_000),
    requirements: z.array(AdaptiveGoalRequirementSchema).min(1).max(3),
    status: z.enum(['active', 'succeeded', 'rejected', 'failed', 'cancelled']),
    project: z
      .object({
        id: z.string().startsWith('project_'),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    currentStepIndex: z.number().int().nonnegative().max(2),
    steps: z.array(GoalExecutionStepSchema).min(1).max(3),
    continuations: z.array(AdaptiveGoalContinuationResultSchema).max(3),
    finalResponse: z
      .object({
        message: z.string().trim().min(1).max(20_000),
        evidence: z.array(ArtifactReferenceSchema).min(1).max(3),
        decisionId: z.string().startsWith('decision_'),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((goal, context) => {
    if (goal.currentStepIndex >= goal.steps.length) {
      context.addIssue({
        code: 'custom',
        path: ['currentStepIndex'],
        message: 'The current adaptive goal step must exist.',
      });
    }

    const requirementIds = new Set<string>();
    goal.requirements.forEach((requirement, index) => {
      if (requirementIds.has(requirement.id)) {
        context.addIssue({
          code: 'custom',
          path: ['requirements', index, 'id'],
          message: 'Adaptive goal requirement ids must be unique.',
        });
      }
      requirementIds.add(requirement.id);
    });

    const stepIndexes = new Map<string, number>();
    goal.steps.forEach((step, index) => {
      if (stepIndexes.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'id'],
          message: 'Adaptive goal step ids must be unique.',
        });
      }
      stepIndexes.set(step.id, index);
      for (const inputStepId of step.inputStepIds) {
        const inputIndex = stepIndexes.get(inputStepId);
        if (inputIndex === undefined || inputIndex >= index) {
          context.addIssue({
            code: 'custom',
            path: ['steps', index, 'inputStepIds'],
            message:
              'Adaptive goal inputs must reference an earlier unique step.',
          });
        }
      }
      if (step.status === 'succeeded' && step.artifact === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'artifact'],
          message: 'A succeeded adaptive goal step must retain its artifact.',
        });
      }
    });

    goal.continuations.forEach((continuation, index) => {
      const observedStepIds = new Set(
        goal.steps.slice(0, index + 1).map((step) => step.id),
      );
      if (
        continuation.decision.kind !== 'rejected' &&
        continuation.decision.evidenceStepIds.some(
          (stepId) => !observedStepIds.has(stepId),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['continuations', index, 'decision', 'evidenceStepIds'],
          message:
            'Adaptive continuation evidence must come from a previously observed step.',
        });
      }
      if (continuation.decision.kind === 'continue_goal') {
        const nextStep = goal.steps[index + 1];
        if (
          nextStep?.id !== continuation.decision.step.id ||
          nextStep.purpose !== continuation.decision.step.purpose ||
          nextStep.capability !== continuation.decision.step.capability ||
          JSON.stringify(nextStep.arguments) !==
            JSON.stringify(continuation.decision.step.arguments) ||
          JSON.stringify(nextStep.inputStepIds) !==
            JSON.stringify(continuation.decision.step.inputStepIds)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['continuations', index, 'decision', 'step'],
            message:
              'An accepted adaptive continuation must match the next persisted step.',
          });
        }
      } else if (index !== goal.continuations.length - 1) {
        context.addIssue({
          code: 'custom',
          path: ['continuations', index, 'decision'],
          message: 'A terminal continuation must be the final decision.',
        });
      }

      if (continuation.decision.kind === 'complete_goal') {
        const resolutions = continuation.decision.requirementResolutions;
        const resolutionIds = resolutions.map(
          ({ requirementId }) => requirementId,
        );
        if (
          new Set(resolutionIds).size !== resolutionIds.length ||
          resolutionIds.length !== goal.requirements.length ||
          resolutionIds.some((id) => !requirementIds.has(id))
        ) {
          context.addIssue({
            code: 'custom',
            path: [
              'continuations',
              index,
              'decision',
              'requirementResolutions',
            ],
            message:
              'Goal completion must resolve every adaptive requirement exactly once.',
          });
        }
        for (const resolution of resolutions) {
          const requirement = goal.requirements.find(
            ({ id }) => id === resolution.requirementId,
          );
          const resolutionEvidenceIsValid =
            new Set(resolution.evidenceStepIds).size ===
              resolution.evidenceStepIds.length &&
            resolution.evidenceStepIds.every((id) => observedStepIds.has(id));
          const satisfiesMatchingCapability =
            resolution.status !== 'satisfied' ||
            resolution.evidenceStepIds.some((stepId) => {
              const step = goal.steps[stepIndexes.get(stepId) ?? -1];
              return (
                step?.capability === requirement?.capability &&
                step?.version === requirement?.version
              );
            });
          const canBeNotApplicable =
            resolution.status !== 'not_applicable' ||
            requirement?.condition.kind === 'evidence_dependent';
          if (
            requirement === undefined ||
            !resolutionEvidenceIsValid ||
            !satisfiesMatchingCapability ||
            !canBeNotApplicable
          ) {
            context.addIssue({
              code: 'custom',
              path: [
                'continuations',
                index,
                'decision',
                'requirementResolutions',
              ],
              message:
                'Adaptive requirement resolutions must be evidence-backed and capability-matched.',
            });
          }
        }
      }
    });

    if (goal.status === 'succeeded') {
      if (
        goal.finalResponse === undefined ||
        goal.steps.some((step) => step.status !== 'succeeded') ||
        goal.continuations.at(-1)?.decision.kind !== 'complete_goal'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['finalResponse'],
          message:
            'A succeeded adaptive goal requires completed steps and a terminal evidence-grounded response.',
        });
      }
    } else if (goal.finalResponse !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['finalResponse'],
        message: 'Only a succeeded adaptive goal may contain a final response.',
      });
    }

    if (goal.finalResponse !== undefined) {
      const artifacts = goal.steps
        .map((step) => step.artifact)
        .filter((artifact) => artifact !== undefined);
      for (const evidence of goal.finalResponse.evidence) {
        if (
          !artifacts.some(
            (artifact) =>
              artifact.id === evidence.id &&
              artifact.type === evidence.type &&
              artifact.mediaType === evidence.mediaType &&
              artifact.sha256 === evidence.sha256 &&
              artifact.byteLength === evidence.byteLength,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['finalResponse', 'evidence'],
            message:
              'Final adaptive goal evidence must reference a completed step artifact exactly.',
          });
        }
      }
    }
  });

export type AdaptiveGoalPlan = z.infer<typeof AdaptiveGoalPlanSchema>;
export type AdaptiveGoalRequirement = z.infer<
  typeof AdaptiveGoalRequirementSchema
>;
export type AdaptiveGoalContinuationProposal = z.infer<
  typeof AdaptiveGoalContinuationProposalSchema
>;
export type AdaptiveGoalContinuationDecision = z.infer<
  typeof AdaptiveGoalContinuationDecisionSchema
>;
export type AdaptiveGoalContinuationResult = z.infer<
  typeof AdaptiveGoalContinuationResultSchema
>;
export type AdaptiveGoalExecution = z.infer<typeof AdaptiveGoalExecutionSchema>;
