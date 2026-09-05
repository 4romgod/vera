import type { DecisionResult } from '../../../domain/model/execution-decision.ts';
import type { Project } from '../../../domain/projects/project.ts';
import type { ProjectContextBundle } from '../../../domain/projects/project-context.ts';
import {
  ApprovalSchema,
  type TaskAggregate,
} from '../../../domain/tasks/task-aggregate.ts';
import { appendEvent, type TaskLifecycleRuntime } from './contracts.ts';
import type { TaskLifecycleFoundation } from './foundation.ts';

export function createDecisionRecording(
  runtime: TaskLifecycleRuntime,
  operations: TaskLifecycleFoundation,
) {
  const { options, clock, createId } = runtime;
  const {
    destinationFor,
    authorityIsWithin,
    setCurrentGoalStepStatus,
    prepareGoalStepApproval,
    update,
  } = operations;
  async function recordDecision(
    aggregate: TaskAggregate,
    decision: DecisionResult,
    approvedContext?: { project: Project; context: ProjectContextBundle },
  ): Promise<TaskAggregate> {
    const selectedCapability =
      decision.decision.kind === 'approval_required'
        ? options.capabilities.selected(decision.decision.capability)
        : null;
    const goalRuntimes =
      decision.decision.kind === 'goal_planned' ||
      decision.decision.kind === 'adaptive_goal_planned'
        ? (decision.decision.kind === 'goal_planned'
            ? decision.decision.plan.steps
            : [decision.decision.plan.firstStep]
          ).map((step) =>
            options.capabilities.selected({
              name: step.capability,
              version: step.version,
            }),
          )
        : [];
    if (
      decision.decision.kind === 'approval_required' &&
      selectedCapability === null
    ) {
      throw new Error(
        `Capability ${decision.decision.capability.name}@${String(decision.decision.capability.version)} is not enabled.`,
      );
    }
    if (goalRuntimes.some((runtime) => runtime === null)) {
      throw new Error('The goal contains an unavailable capability runtime.');
    }
    const selectedDestination =
      decision.decision.kind === 'approval_required' &&
      selectedCapability !== null
        ? destinationFor(
            selectedCapability,
            decision.decision.proposedArguments,
          )
        : undefined;
    const approvalCapability =
      decision.decision.kind === 'approval_required' &&
      selectedDestination !== undefined
        ? options.capabilities.resolve(
            decision.decision.capability,
            selectedDestination,
          )
        : null;
    if (
      decision.decision.kind === 'approval_required' &&
      approvalCapability === null
    ) {
      throw new Error('The selected capability destination is unavailable.');
    }
    const selectedAuthority =
      decision.decision.kind === 'approval_required' &&
      approvalCapability !== null
        ? approvalCapability.authorityFor({
            arguments: decision.decision.proposedArguments,
            hasInputArtifacts: false,
            hasDecisionEvidence: false,
          })
        : undefined;
    if (
      approvalCapability !== null &&
      selectedAuthority !== undefined &&
      !authorityIsWithin(selectedAuthority, approvalCapability.authority)
    ) {
      throw new Error(
        'The capability resolved authority outside its declared maximum.',
      );
    }
    const approvalId = createId('approval');
    const now = clock();
    const result = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        if (candidate.run.status !== 'deciding') {
          return false;
        }

        candidate.run.decision = decision;
        candidate.run.updatedAt = now;
        candidate.task.updatedAt = now;
        appendEvent(
          candidate,
          'model_decision_recorded',
          now,
          { decisionId: decision.decisionId, kind: decision.decision.kind },
          createId,
        );

        if (decision.decision.kind === 'respond') {
          candidate.run.status = 'succeeded';
          candidate.task.status = 'completed';
          candidate.run.output = {
            kind: 'response',
            message: decision.decision.message,
          };
          appendEvent(candidate, 'run_succeeded', now, {}, createId);
          return true;
        }

        if (decision.decision.kind === 'rejected') {
          candidate.run.status = 'rejected';
          candidate.task.status = 'rejected';
          appendEvent(
            candidate,
            'run_rejected',
            now,
            { code: decision.decision.code },
            createId,
          );
          return true;
        }

        if (decision.decision.kind === 'goal_planned') {
          const requiresProjectContext = goalRuntimes.some(
            (runtime) => runtime?.authority.projectContext === 'required',
          );
          if (requiresProjectContext && approvedContext === undefined) {
            throw new Error('Goal project context was not assembled.');
          }
          if (!requiresProjectContext && approvedContext !== undefined) {
            throw new Error(
              'A project-independent goal cannot receive project context.',
            );
          }
          if (approvedContext !== undefined) {
            candidate.run.context = approvedContext.context;
            appendEvent(
              candidate,
              'context_assembled',
              now,
              {
                projectId: approvedContext.project.id,
                revision: approvedContext.context.manifest.revision,
                totalFiles: approvedContext.context.manifest.totalFiles,
                totalBytes: approvedContext.context.manifest.totalBytes,
              },
              createId,
            );
          }
          candidate.run.goal = {
            schemaVersion: 1,
            objective: decision.decision.plan.objective,
            summary: decision.decision.plan.summary,
            status: 'active',
            ...(approvedContext === undefined
              ? {}
              : {
                  project: {
                    id: approvedContext.project.id,
                    displayName: approvedContext.project.displayName,
                  },
                }),
            currentStepIndex: 0,
            steps: decision.decision.plan.steps.map((step) => ({
              ...step,
              status: 'pending' as const,
            })),
          };
          appendEvent(
            candidate,
            'goal_planned',
            now,
            {
              stepCount: candidate.run.goal.steps.length,
              capabilities: candidate.run.goal.steps.map(
                (step) => `${step.capability}@${String(step.version)}`,
              ),
            },
            createId,
          );
          prepareGoalStepApproval(candidate, 0, now);
          return true;
        }

        if (decision.decision.kind === 'adaptive_goal_planned') {
          const requiresProjectContext = goalRuntimes.some(
            (runtime) => runtime?.authority.projectContext === 'required',
          );
          if (requiresProjectContext && approvedContext === undefined) {
            throw new Error('Adaptive goal project context was not assembled.');
          }
          if (!requiresProjectContext && approvedContext !== undefined) {
            throw new Error(
              'A project-independent adaptive goal cannot receive project context.',
            );
          }
          if (approvedContext !== undefined) {
            candidate.run.context = approvedContext.context;
            appendEvent(
              candidate,
              'context_assembled',
              now,
              {
                projectId: approvedContext.project.id,
                revision: approvedContext.context.manifest.revision,
                totalFiles: approvedContext.context.manifest.totalFiles,
                totalBytes: approvedContext.context.manifest.totalBytes,
              },
              createId,
            );
          }
          candidate.run.goal = {
            schemaVersion: 2,
            mode: 'adaptive',
            objective: decision.decision.plan.objective,
            summary: decision.decision.plan.summary,
            completionCriteria: decision.decision.plan.completionCriteria,
            requirements: decision.decision.plan.requirements,
            status: 'active',
            ...(approvedContext === undefined
              ? {}
              : {
                  project: {
                    id: approvedContext.project.id,
                    displayName: approvedContext.project.displayName,
                  },
                }),
            currentStepIndex: 0,
            steps: [
              {
                ...decision.decision.plan.firstStep,
                status: 'pending' as const,
              },
            ],
            continuations: [],
          };
          appendEvent(
            candidate,
            'adaptive_goal_planned',
            now,
            {
              completionCriteria: candidate.run.goal.completionCriteria,
              firstCapability: `${decision.decision.plan.firstStep.capability}@${String(decision.decision.plan.firstStep.version)}`,
            },
            createId,
          );
          prepareGoalStepApproval(candidate, 0, now);
          return true;
        }

        if (selectedCapability === null) {
          throw new Error('The approved capability runtime is unavailable.');
        }
        if (approvalCapability === null || selectedDestination === undefined) {
          throw new Error(
            'The approved capability destination is unavailable.',
          );
        }
        const requiresProjectContext =
          approvalCapability.authority.projectContext === 'required';
        if (requiresProjectContext && approvedContext === undefined) {
          throw new Error('Approved project context was not assembled.');
        }
        if (!requiresProjectContext && approvedContext !== undefined) {
          throw new Error(
            'A project-independent capability cannot receive project context.',
          );
        }
        candidate.run.status = 'awaiting_approval';
        if (approvedContext !== undefined) {
          candidate.run.context = approvedContext.context;
        }
        candidate.run.approval = ApprovalSchema.parse({
          id: approvalId,
          status:
            selectedAuthority?.approval === 'never' ? 'approved' : 'pending',
          reason: decision.decision.reason,
          capability: decision.decision.capability,
          proposedArguments: decision.decision.proposedArguments,
          ...(approvedContext === undefined
            ? {}
            : {
                project: {
                  id: approvedContext.project.id,
                  displayName: approvedContext.project.displayName,
                },
                contextManifest: approvedContext.context.manifest,
              }),
          destination: selectedDestination,
          authority: selectedAuthority,
          ...(decision.decision.capability.name === 'attachment_analysis'
            ? { attachments: candidate.task.attachments }
            : {}),
          requestedAt: now,
          ...(selectedAuthority?.approval === 'never'
            ? { decidedAt: now, decidedBy: 'vera_policy' }
            : {}),
        });
        if (approvedContext !== undefined) {
          appendEvent(
            candidate,
            'context_assembled',
            now,
            {
              projectId: approvedContext.project.id,
              revision: approvedContext.context.manifest.revision,
              totalFiles: approvedContext.context.manifest.totalFiles,
              totalBytes: approvedContext.context.manifest.totalBytes,
            },
            createId,
          );
        }
        appendEvent(
          candidate,
          'approval_requested',
          now,
          {
            approvalId,
            capability: `${decision.decision.capability.name}@${String(decision.decision.capability.version)}`,
          },
          createId,
        );
        if (selectedAuthority?.approval === 'never') {
          appendEvent(
            candidate,
            'approval_approved',
            now,
            { approvalId, decidedBy: 'vera_policy' },
            createId,
          );
        }
        return true;
      },
    );
    return result.aggregate;
  }

  async function recordFailure(
    principalId: string,
    taskId: string,
    code:
      | 'model_provider_failure'
      | 'capability_execution_failure'
      | 'internal_failure'
      | 'project_required'
      | 'project_not_found'
      | 'project_context_failure'
      | 'conversation_context_failure'
      | 'memory_context_failure'
      | 'external_signal_context_failure'
      | 'adaptive_goal_failure'
      | 'budget_exhausted'
      | 'cancelled',
    publicMessage: string,
    eventType: 'run_failed' | 'capability_invocation_failed',
  ): Promise<TaskAggregate> {
    const now = clock();
    const result = await update(principalId, taskId, (aggregate) => {
      if (
        aggregate.run.status === 'succeeded' ||
        aggregate.run.status === 'rejected' ||
        aggregate.run.status === 'failed' ||
        aggregate.run.status === 'cancelled'
      ) {
        return false;
      }
      aggregate.run.status = 'failed';
      aggregate.task.status = 'failed';
      aggregate.run.failure = { code, message: publicMessage };
      if (aggregate.run.goal !== undefined) {
        aggregate.run.goal.status = 'failed';
        setCurrentGoalStepStatus(aggregate, 'failed');
      }
      aggregate.run.updatedAt = now;
      aggregate.task.updatedAt = now;
      if (aggregate.run.invocation?.status === 'executing') {
        aggregate.run.invocation.status = 'failed';
        aggregate.run.invocation.completedAt = now;
      }
      appendEvent(aggregate, eventType, now, { code }, createId);
      if (eventType !== 'run_failed') {
        appendEvent(aggregate, 'run_failed', now, { code }, createId);
      }
      return true;
    });
    return result.aggregate;
  }

  return { recordDecision, recordFailure };
}

export type TaskLifecycleDecisionRecording = ReturnType<
  typeof createDecisionRecording
>;
