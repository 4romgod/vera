import type { AdaptiveGoalObservation } from '../../model-decisions/evaluate-goal-continuation.ts';
import { assertProjectContextIntegrity } from '../../projects/validate-project-context.ts';
import {
  nextAdaptiveGoalStepId,
  type AdaptiveGoalContinuationResult,
} from '../../../domain/goals/adaptive-goal.ts';
import type { Project } from '../../../domain/projects/project.ts';
import type { ProjectContextBundle } from '../../../domain/projects/project-context.ts';
import { type TaskAggregate } from '../../../domain/tasks/task-aggregate.ts';
import {
  appendEvent,
  LifecycleError,
  type TaskLifecycleRuntime,
} from './contracts.ts';
import type { TaskLifecycleFoundation } from './foundation.ts';
import type { TaskLifecycleDecisionRecording } from './decision-recording.ts';

export function createAdaptiveGoalOperations(
  runtime: TaskLifecycleRuntime,
  operations: TaskLifecycleFoundation & TaskLifecycleDecisionRecording,
) {
  const { options, clock, createId, budget, ownerTimeZone } = runtime;
  const {
    artifactContentIsIntact,
    archiveCurrentGoalBoundary,
    prepareGoalStepApproval,
    update,
  } = operations;
  async function loadAdaptiveGoalObservations(
    aggregate: TaskAggregate,
  ): Promise<AdaptiveGoalObservation[]> {
    const goal = aggregate.run.goal;
    if (goal?.schemaVersion !== 2) {
      throw new Error('The run does not contain an adaptive goal.');
    }
    const observations: AdaptiveGoalObservation[] = [];
    for (const step of goal.steps) {
      if (step.status !== 'succeeded' || step.artifact === undefined) {
        throw new Error(
          `Adaptive goal step ${step.id} is missing its completed artifact.`,
        );
      }
      const artifact = await options.resources.findArtifactById(
        aggregate.task.principalId,
        step.artifact.id,
      );
      if (artifact === null) {
        throw new Error(
          `Adaptive goal observation ${step.id} failed integrity or scope validation.`,
        );
      }
      const artifactProjectId =
        'projectId' in artifact ? artifact.projectId : undefined;
      if (
        artifact.taskId !== aggregate.task.id ||
        artifact.runId !== aggregate.run.id ||
        artifact.type !== step.artifact.type ||
        artifact.mediaType !== step.artifact.mediaType ||
        artifact.sha256 !== step.artifact.sha256 ||
        artifact.byteLength !== step.artifact.byteLength ||
        (artifactProjectId !== undefined &&
          artifactProjectId !== aggregate.task.projectId) ||
        !artifactContentIsIntact(artifact)
      ) {
        throw new Error(
          `Adaptive goal observation ${step.id} failed integrity or scope validation.`,
        );
      }
      observations.push({
        stepId: step.id,
        purpose: step.purpose,
        capability: { name: step.capability, version: step.version },
        artifact,
      });
    }
    return observations;
  }

  async function assembleAdaptiveStepContext(
    aggregate: TaskAggregate,
    step: NonNullable<
      Extract<
        AdaptiveGoalContinuationResult['decision'],
        { kind: 'continue_goal' }
      >['step']
    >,
  ): Promise<{ project: Project; context: ProjectContextBundle } | undefined> {
    const runtime = options.capabilities.selected({
      name: step.capability,
      version: step.version,
    });
    if (runtime === null) {
      throw new Error('The adaptive continuation runtime is unavailable.');
    }
    if (runtime.authority.projectContext !== 'required') return undefined;
    const projectId = aggregate.task.projectId;
    if (projectId === undefined) {
      throw new LifecycleError(
        'A registered projectId is required for this adaptive goal step.',
        'project_required',
      );
    }
    const project = await options.resources.findProjectById(
      aggregate.task.principalId,
      projectId,
    );
    if (project === null) {
      throw new LifecycleError(
        `Project ${projectId} was not found.`,
        'project_not_found',
      );
    }
    if (aggregate.run.context !== undefined) {
      assertProjectContextIntegrity(aggregate.run.context, project.id);
      return { project, context: aggregate.run.context };
    }
    if (!('ticket' in step.arguments)) {
      throw new Error(
        'The adaptive project step is missing project-routing arguments.',
      );
    }
    const runBudget = aggregate.run.budget ?? budget;
    const context = await options.contextAssembler.assemble({
      project,
      objective: step.arguments.objective,
      ticket: step.arguments.ticket,
      limits: {
        maxFiles: runBudget.limits.maxContextFiles,
        maxBytes: runBudget.limits.maxContextBytes,
        maxFileBytes: runBudget.limits.maxContextFileBytes,
      },
    });
    assertProjectContextIntegrity(context, project.id);
    return { project, context };
  }

  async function recordAdaptiveGoalContinuation(
    aggregate: TaskAggregate,
    continuation: AdaptiveGoalContinuationResult,
    assembledContext?: { project: Project; context: ProjectContextBundle },
  ): Promise<TaskAggregate> {
    const result = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        const goal = candidate.run.goal;
        const currentStep = goal?.steps[goal.currentStepIndex];
        if (
          candidate.run.status !== 'deciding' ||
          goal?.schemaVersion !== 2 ||
          goal.status !== 'active' ||
          currentStep?.status !== 'succeeded'
        ) {
          return false;
        }
        if (
          goal.continuations.some(
            (record) => record.decisionId === continuation.decisionId,
          )
        ) {
          return false;
        }
        goal.continuations.push(continuation);
        candidate.run.updatedAt = continuation.decidedAt;
        candidate.task.updatedAt = continuation.decidedAt;
        appendEvent(
          candidate,
          'adaptive_goal_continuation_recorded',
          continuation.decidedAt,
          {
            decisionId: continuation.decisionId,
            kind: continuation.decision.kind,
            observedStepIds: goal.steps.map((step) => step.id),
          },
          createId,
        );

        if (continuation.decision.kind === 'rejected') {
          goal.status = 'failed';
          candidate.run.status = 'failed';
          candidate.task.status = 'failed';
          candidate.run.failure = {
            code:
              continuation.decision.code === 'budget_exhausted'
                ? 'budget_exhausted'
                : 'adaptive_goal_failure',
            message: continuation.decision.message,
          };
          appendEvent(
            candidate,
            'run_failed',
            continuation.decidedAt,
            { code: continuation.decision.code },
            createId,
          );
          return true;
        }

        const evidence = continuation.decision.evidenceStepIds.map((stepId) => {
          const step = goal.steps.find(
            (candidateStep) => candidateStep.id === stepId,
          );
          if (step?.artifact === undefined) {
            throw new Error(
              `Adaptive continuation evidence ${stepId} is unavailable.`,
            );
          }
          return step.artifact;
        });

        if (continuation.decision.kind === 'complete_goal') {
          const artifacts = goal.steps.map((step) => {
            if (step.artifact === undefined) {
              throw new Error('An adaptive goal step is missing its artifact.');
            }
            return step.artifact;
          });
          const verifiedExecution = goal.steps
            .map((step) => `${step.capability}@${String(step.version)}`)
            .join(', ');
          const requirementResolutions =
            continuation.decision.requirementResolutions;
          const verifiedOutcomes = requirementResolutions.map((resolution) => {
            const requirement = goal.requirements.find(
              ({ id }) => id === resolution.requirementId,
            );
            if (requirement === undefined) {
              throw new Error(
                `Adaptive requirement ${resolution.requirementId} is unavailable.`,
              );
            }
            return resolution.status === 'satisfied'
              ? `Completed: ${requirement.description} (verified by ${requirement.capability}@${String(requirement.version)}).`
              : `Not performed: ${requirement.description} The orchestration brain judged its evidence-dependent condition not applicable.`;
          });
          const hasUnperformedOutcome = requirementResolutions.some(
            ({ status }) => status === 'not_applicable',
          );
          const finalMessage = [
            `Verified outcomes:\n${verifiedOutcomes.map((outcome) => `- ${outcome}`).join('\n')}`,
            ...(hasUnperformedOutcome
              ? []
              : [
                  `Evidence-grounded summary: ${continuation.decision.message}`,
                ]),
            `Verified execution record: ${verifiedExecution}. No other capability or side effect was executed in this goal.`,
          ].join('\n\n');
          goal.status = 'succeeded';
          goal.finalResponse = {
            message: finalMessage,
            evidence,
            decisionId: continuation.decisionId,
          };
          candidate.run.status = 'succeeded';
          candidate.task.status = 'completed';
          candidate.run.output = {
            kind: 'adaptive_goal_result',
            objective: goal.objective,
            message: finalMessage,
            evidence,
            artifacts,
          };
          appendEvent(
            candidate,
            'adaptive_goal_succeeded',
            continuation.decidedAt,
            {
              evidenceArtifactIds: evidence.map((artifact) => artifact.id),
              artifactIds: artifacts.map((artifact) => artifact.id),
            },
            createId,
          );
          appendEvent(
            candidate,
            'run_succeeded',
            continuation.decidedAt,
            {},
            createId,
          );
          return true;
        }

        if (goal.steps.length >= 3) {
          throw new Error(
            'The adaptive continuation exceeded the three-step ceiling.',
          );
        }
        if (assembledContext !== undefined) {
          if (
            candidate.run.context !== undefined &&
            candidate.run.context.manifest.revision !==
              assembledContext.context.manifest.revision
          ) {
            throw new Error(
              'The adaptive goal project context changed after it was frozen.',
            );
          }
          if (candidate.run.context === undefined) {
            candidate.run.context = assembledContext.context;
            appendEvent(
              candidate,
              'context_assembled',
              continuation.decidedAt,
              {
                projectId: assembledContext.project.id,
                revision: assembledContext.context.manifest.revision,
                totalFiles: assembledContext.context.manifest.totalFiles,
                totalBytes: assembledContext.context.manifest.totalBytes,
              },
              createId,
            );
          }
          goal.project ??= {
            id: assembledContext.project.id,
            displayName: assembledContext.project.displayName,
          };
        }
        archiveCurrentGoalBoundary(candidate);
        goal.steps.push({
          ...continuation.decision.step,
          status: 'pending',
        });
        prepareGoalStepApproval(
          candidate,
          goal.steps.length - 1,
          continuation.decidedAt,
          evidence,
        );
        return true;
      },
    );
    return result.aggregate;
  }

  async function evaluateAdaptiveGoalContinuation(
    aggregate: TaskAggregate,
    selectedProject?: Project | null,
  ): Promise<TaskAggregate> {
    const goal = aggregate.run.goal;
    if (goal?.schemaVersion !== 2) {
      throw new Error('The run does not contain an adaptive goal.');
    }
    const evaluator = options.evaluateGoalContinuation;
    if (evaluator === undefined) {
      throw new Error('Adaptive goal continuation is not configured.');
    }
    const observations = await loadAdaptiveGoalObservations(aggregate);
    const observationBytes = observations.reduce(
      (total, observation) => total + observation.artifact.byteLength,
      0,
    );
    const contextByteLimit =
      aggregate.run.budget?.limits.maxContextBytes ??
      budget.limits.maxContextBytes;
    if (observationBytes > contextByteLimit) {
      const failedAt = clock();
      const failure = await update(
        aggregate.task.principalId,
        aggregate.task.id,
        (candidate) => {
          if (
            candidate.run.status !== 'deciding' ||
            candidate.run.goal?.schemaVersion !== 2 ||
            candidate.run.goal.status !== 'active'
          ) {
            return false;
          }
          candidate.run.goal.status = 'failed';
          candidate.run.status = 'failed';
          candidate.task.status = 'failed';
          candidate.run.failure = {
            code: 'budget_exhausted',
            message:
              'The adaptive goal observations exceeded the model-context byte budget.',
          };
          candidate.run.updatedAt = failedAt;
          candidate.task.updatedAt = failedAt;
          appendEvent(
            candidate,
            'budget_exhausted',
            failedAt,
            {
              resource: 'adaptive_observation_bytes',
              consumed: observationBytes,
              limit: contextByteLimit,
            },
            createId,
          );
          appendEvent(
            candidate,
            'run_failed',
            failedAt,
            { code: 'budget_exhausted' },
            createId,
          );
          return true;
        },
      );
      return failure.aggregate;
    }
    const continuation = await evaluator({
      ownerMessage: aggregate.task.message,
      objective: goal.objective,
      completionCriteria: goal.completionCriteria,
      requirements: goal.requirements,
      observations,
      nextStepId: nextAdaptiveGoalStepId(goal.steps.map(({ id }) => id)),
      remainingCapabilityInvocations: Math.max(
        0,
        (aggregate.run.budget?.limits.capabilityInvocations ??
          budget.limits.capabilityInvocations) - goal.steps.length,
      ),
      ...(selectedProject === undefined || selectedProject === null
        ? {}
        : {
            selectedProject: {
              id: selectedProject.id,
              displayName: selectedProject.displayName,
            },
          }),
      temporalContext: {
        currentTime: aggregate.task.createdAt,
        ownerTimeZone,
      },
    });
    const assembledContext =
      continuation.decision.kind === 'continue_goal'
        ? await assembleAdaptiveStepContext(
            aggregate,
            continuation.decision.step,
          )
        : undefined;
    return recordAdaptiveGoalContinuation(
      aggregate,
      continuation,
      assembledContext,
    );
  }

  return {
    loadAdaptiveGoalObservations,
    assembleAdaptiveStepContext,
    recordAdaptiveGoalContinuation,
    evaluateAdaptiveGoalContinuation,
  };
}

export type TaskLifecycleAdaptiveGoalOperations = ReturnType<
  typeof createAdaptiveGoalOperations
>;
