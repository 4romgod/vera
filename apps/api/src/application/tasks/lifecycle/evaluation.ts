import { assertConversationContextIntegrity } from '../../conversations/validate-conversation-context.ts';
import { assertProjectContextIntegrity } from '../../projects/validate-project-context.ts';
import type { ProjectContextBundle } from '../../../domain/projects/project-context.ts';
import { type TaskAggregate } from '../../../domain/tasks/task-aggregate.ts';
import { ModelProviderError } from '../../../ports/model/model-provider.ts';
import { assertMemoryContextIntegrity } from '../../memories/validate-memory-context.ts';
import { appendEvent, type TaskLifecycleRuntime } from './contracts.ts';
import type { TaskLifecycleFoundation } from './foundation.ts';
import type { TaskLifecycleDecisionRecording } from './decision-recording.ts';
import type { TaskLifecycleAdaptiveGoalOperations } from './adaptive-goal.ts';
import { shouldAssembleSoftwareDeliveryContext } from '../../software-delivery/software-delivery-context.ts';

export function createEvaluationOperations(
  runtime: TaskLifecycleRuntime,
  operations: TaskLifecycleFoundation &
    TaskLifecycleDecisionRecording &
    TaskLifecycleAdaptiveGoalOperations,
) {
  const { options, observer, clock, createId, budget } = runtime;
  const {
    setCurrentGoalStepStatus,
    update,
    recordDecision,
    recordFailure,
    evaluateAdaptiveGoalContinuation,
  } = operations;
  async function evaluate(aggregate: TaskAggregate): Promise<TaskAggregate> {
    const consumedAt = clock();
    const budgetClaim = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        if (candidate.run.status !== 'deciding') return false;
        candidate.run.budget ??= structuredClone(budget);
        const elapsed =
          Date.parse(consumedAt) - Date.parse(candidate.run.createdAt);
        if (
          candidate.run.budget.consumed.modelCalls >=
            candidate.run.budget.limits.modelCalls ||
          elapsed >= candidate.run.budget.limits.maxDurationMs
        ) {
          candidate.run.status = 'failed';
          candidate.task.status = 'failed';
          if (candidate.run.goal !== undefined) {
            candidate.run.goal.status = 'failed';
            setCurrentGoalStepStatus(candidate, 'failed');
          }
          candidate.run.failure = {
            code: 'budget_exhausted',
            message: 'The run exhausted its model-call or duration budget.',
          };
          candidate.run.updatedAt = consumedAt;
          candidate.task.updatedAt = consumedAt;
          appendEvent(
            candidate,
            'budget_exhausted',
            consumedAt,
            { resource: 'model_calls_or_duration' },
            createId,
          );
          appendEvent(
            candidate,
            'run_failed',
            consumedAt,
            { code: 'budget_exhausted' },
            createId,
          );
          return true;
        }
        candidate.run.budget.consumed.modelCalls += 1;
        candidate.run.updatedAt = consumedAt;
        candidate.task.updatedAt = consumedAt;
        appendEvent(
          candidate,
          'budget_consumed',
          consumedAt,
          {
            resource: 'model_calls',
            consumed: candidate.run.budget.consumed.modelCalls,
            limit: candidate.run.budget.limits.modelCalls,
          },
          createId,
        );
        return true;
      },
    );
    if (budgetClaim.aggregate.run.status !== 'deciding') {
      return budgetClaim.aggregate;
    }
    try {
      const selectedProjectId = budgetClaim.aggregate.task.projectId;
      const selectedProject =
        selectedProjectId === undefined
          ? undefined
          : await options.resources.findProjectById(
              budgetClaim.aggregate.task.principalId,
              selectedProjectId,
            );
      if (selectedProjectId !== undefined && selectedProject === null) {
        return await recordFailure(
          budgetClaim.aggregate.task.principalId,
          budgetClaim.aggregate.task.id,
          'project_not_found',
          `Project ${selectedProjectId} was not found.`,
          'run_failed',
        );
      }
      const conversationContext = budgetClaim.aggregate.run.conversationContext;
      if (conversationContext !== undefined) {
        try {
          const conversationId = budgetClaim.aggregate.task.conversationId;
          const messageId = budgetClaim.aggregate.task.messageId;
          if (conversationId === undefined || messageId === undefined) {
            throw new Error(
              'Conversation context is attached to a non-conversation task.',
            );
          }
          const conversation = await options.resources.findConversationById(
            budgetClaim.aggregate.task.principalId,
            conversationId,
          );
          if (conversation === null) {
            throw new Error(
              'Conversation context references a missing conversation.',
            );
          }
          assertConversationContextIntegrity(conversationContext, {
            conversationId,
            throughMessageId: messageId,
            conversation,
            ...(budgetClaim.aggregate.task.projectId === undefined
              ? {}
              : { projectId: budgetClaim.aggregate.task.projectId }),
          });
        } catch (error) {
          observer.warning(error, {
            operation: 'conversation_context_validation',
            taskId: budgetClaim.aggregate.task.id,
            runId: budgetClaim.aggregate.run.id,
          });
          return await recordFailure(
            budgetClaim.aggregate.task.principalId,
            budgetClaim.aggregate.task.id,
            'conversation_context_failure',
            'Vera could not validate the frozen conversation context.',
            'run_failed',
          );
        }
      }
      const memoryContext = budgetClaim.aggregate.run.memoryContext;
      if (memoryContext !== undefined) {
        try {
          await assertMemoryContextIntegrity({
            context: memoryContext,
            store: options.resources,
            principalId: budgetClaim.aggregate.task.principalId,
            ...(budgetClaim.aggregate.task.projectId === undefined
              ? {}
              : { projectId: budgetClaim.aggregate.task.projectId }),
          });
        } catch (error) {
          observer.warning(error, {
            operation: 'memory_context_validation',
            taskId: budgetClaim.aggregate.task.id,
            runId: budgetClaim.aggregate.run.id,
          });
          return await recordFailure(
            budgetClaim.aggregate.task.principalId,
            budgetClaim.aggregate.task.id,
            'memory_context_failure',
            'Vera could not validate the frozen memory context.',
            'run_failed',
          );
        }
      }
      const softwareDeliveryContext =
        options.softwareDeliveryContext !== undefined &&
        shouldAssembleSoftwareDeliveryContext(
          budgetClaim.aggregate.task.message,
        )
          ? await options.softwareDeliveryContext.assemble(
              budgetClaim.aggregate.task.principalId,
            )
          : undefined;
      if (
        budgetClaim.aggregate.run.goal?.schemaVersion === 2 &&
        budgetClaim.aggregate.run.goal.status === 'active'
      ) {
        return await evaluateAdaptiveGoalContinuation(
          budgetClaim.aggregate,
          selectedProject,
        );
      }
      const decision = await options.evaluateModelDecision(
        budgetClaim.aggregate.task.message,
        {
          temporalContext: {
            // Relative dates must be stable if decision-making is retried
            // after a crash, so anchor them to the durable request instant.
            currentTime: budgetClaim.aggregate.task.createdAt,
          },
          ...(selectedProject === undefined || selectedProject === null
            ? {}
            : {
                selectedProject: {
                  id: selectedProject.id,
                  displayName: selectedProject.displayName,
                },
              }),
          ...(budgetClaim.aggregate.run.conversationContext === undefined
            ? {}
            : {
                conversationContext:
                  budgetClaim.aggregate.run.conversationContext,
              }),
          ...(memoryContext === undefined ? {} : { memoryContext }),
          ...(softwareDeliveryContext === undefined
            ? {}
            : { softwareDeliveryContext }),
          ...(budgetClaim.aggregate.task.attachments === undefined
            ? {}
            : { attachments: budgetClaim.aggregate.task.attachments }),
        },
      );
      if (
        decision.decision.kind !== 'approval_required' &&
        decision.decision.kind !== 'goal_planned' &&
        decision.decision.kind !== 'adaptive_goal_planned'
      ) {
        return await recordDecision(budgetClaim.aggregate, decision);
      }
      const plannedSteps =
        decision.decision.kind === 'goal_planned'
          ? decision.decision.plan.steps
          : decision.decision.kind === 'adaptive_goal_planned'
            ? [decision.decision.plan.firstStep]
            : [
                {
                  capability: decision.decision.capability.name,
                  version: decision.decision.capability.version,
                  arguments: decision.decision.proposedArguments,
                },
              ];
      const plannedRuntimes = plannedSteps.map((step) =>
        options.capabilities.selected({
          name: step.capability,
          version: step.version,
        }),
      );
      if (plannedRuntimes.some((runtime) => runtime === null)) {
        throw new Error(
          'The proposed work contains an unavailable capability.',
        );
      }
      const firstProjectStep = plannedSteps.find(
        (_step, index) =>
          plannedRuntimes[index]?.authority.projectContext === 'required',
      );
      if (firstProjectStep === undefined) {
        return await recordDecision(budgetClaim.aggregate, decision);
      }
      if (selectedProjectId === undefined) {
        return await recordFailure(
          budgetClaim.aggregate.task.principalId,
          budgetClaim.aggregate.task.id,
          'project_required',
          'A registered projectId is required for specialist project work.',
          'run_failed',
        );
      }
      if (selectedProject === undefined || selectedProject === null) {
        return await recordFailure(
          budgetClaim.aggregate.task.principalId,
          budgetClaim.aggregate.task.id,
          'project_not_found',
          `Project ${selectedProjectId} was not found.`,
          'run_failed',
        );
      }
      const runBudget = budgetClaim.aggregate.run.budget ?? budget;
      if (!('ticket' in firstProjectStep.arguments)) {
        throw new Error(
          'A project capability is missing project-routing arguments.',
        );
      }
      let context: ProjectContextBundle;
      try {
        context = await options.contextAssembler.assemble({
          project: selectedProject,
          ...(budgetClaim.aggregate.task.projectRevision === undefined
            ? {}
            : { revision: budgetClaim.aggregate.task.projectRevision }),
          objective: firstProjectStep.arguments.objective,
          ticket: firstProjectStep.arguments.ticket,
          limits: {
            maxFiles: runBudget.limits.maxContextFiles,
            maxBytes: runBudget.limits.maxContextBytes,
            maxFileBytes: runBudget.limits.maxContextFileBytes,
          },
        });
        assertProjectContextIntegrity(context, selectedProject.id);
        if (
          budgetClaim.aggregate.task.projectRevision !== undefined &&
          context.manifest.revision !==
            budgetClaim.aggregate.task.projectRevision
        ) {
          throw new Error(
            'Project context does not match the requested revision.',
          );
        }
      } catch (error) {
        observer.warning(error, {
          operation: 'project_context_assembly',
          taskId: budgetClaim.aggregate.task.id,
          runId: budgetClaim.aggregate.run.id,
          projectId: selectedProjectId,
        });
        return await recordFailure(
          budgetClaim.aggregate.task.principalId,
          budgetClaim.aggregate.task.id,
          'project_context_failure',
          'Vera could not assemble bounded project context.',
          'run_failed',
        );
      }
      return await recordDecision(budgetClaim.aggregate, decision, {
        project: selectedProject,
        context,
      });
    } catch (error) {
      observer.warning(error, {
        operation: 'model_decision',
        taskId: aggregate.task.id,
        runId: aggregate.run.id,
      });
      return recordFailure(
        aggregate.task.principalId,
        aggregate.task.id,
        error instanceof ModelProviderError
          ? 'model_provider_failure'
          : aggregate.run.goal?.schemaVersion === 2
            ? 'adaptive_goal_failure'
            : 'internal_failure',
        error instanceof ModelProviderError
          ? 'The model provider could not decide how to handle this task.'
          : aggregate.run.goal?.schemaVersion === 2
            ? 'Vera could not validate or continue the adaptive goal.'
            : 'Vera could not decide how to handle this task.',
        'run_failed',
      );
    }
  }

  return { evaluate };
}

export type TaskLifecycleEvaluationOperations = ReturnType<
  typeof createEvaluationOperations
>;
