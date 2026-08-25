import { createHash, randomUUID } from 'node:crypto';

import type { EvaluateModelDecision } from './evaluate-model-decision.ts';
import { assertProjectContextIntegrity } from './validate-project-context.ts';
import type { DecisionResult } from '../domain/execution-decision.ts';
import { ArtifactSchema, type Artifact } from '../domain/artifact.ts';
import { sameCapabilityDestination } from '../domain/capability-destination.ts';
import type { Project } from '../domain/project.ts';
import type { ProjectContextBundle } from '../domain/project-context.ts';
import { DefaultRunBudget, type RunBudget } from '../domain/run-budget.ts';
import {
  TaskAggregateSchema,
  type TaskAggregate,
  type TaskEventType,
} from '../domain/task-aggregate.ts';
import { ModelProviderError } from '../model/model-provider.ts';
import type { DevelopmentPlanningCapabilityRegistry } from '../ports/development-planning-capability.ts';
import type { ExecutionStore } from '../ports/execution-store.ts';
import type { ProjectContextAssembler } from '../ports/project-context-assembler.ts';
import type { ResourceStore } from '../ports/resource-store.ts';
import { projectAggregate, type Scratchpad } from '../ports/scratchpad.ts';

export type LifecycleErrorCode =
  | 'task_not_found'
  | 'run_not_found'
  | 'approval_not_found'
  | 'approval_already_decided'
  | 'idempotency_key_reused'
  | 'project_required'
  | 'project_not_found'
  | 'concurrent_transition_failed';

export class LifecycleError extends Error {
  public constructor(
    message: string,
    public readonly code: LifecycleErrorCode,
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

export type LifecycleObserver = {
  warning(error: unknown, context: Record<string, unknown>): void;
};

export type TaskLifecycle = {
  submit(input: {
    message: string;
    requestKey: string;
    principalId: string;
    projectId?: string;
    conversationId?: string;
    messageId?: string;
  }): Promise<TaskAggregate>;
  getTask(principalId: string, taskId: string): Promise<TaskAggregate>;
  getRun(principalId: string, runId: string): Promise<TaskAggregate>;
  decideApproval(input: {
    approvalId: string;
    decision: 'approved' | 'rejected';
    principalId: string;
  }): Promise<TaskAggregate>;
  cancelRun(input: {
    runId: string;
    principalId: string;
  }): Promise<TaskAggregate>;
  recoverInterrupted(): Promise<void>;
};

type IdFactory = (prefix: string) => string;
type Clock = () => string;

const defaultObserver: LifecycleObserver = {
  warning: () => undefined,
};

function appendEvent(
  aggregate: TaskAggregate,
  type: TaskEventType,
  occurredAt: string,
  data: Record<string, unknown>,
  createId: IdFactory,
): void {
  aggregate.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: aggregate.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

export function createTaskLifecycle(options: {
  store: ExecutionStore;
  scratchpad: Scratchpad;
  evaluateModelDecision: EvaluateModelDecision;
  developmentPlanning: DevelopmentPlanningCapabilityRegistry;
  resources: ResourceStore;
  contextAssembler: ProjectContextAssembler;
  budget?: RunBudget;
  observer?: LifecycleObserver;
  clock?: Clock;
  createId?: IdFactory;
}): TaskLifecycle {
  const observer = options.observer ?? defaultObserver;
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const budget = options.budget ?? DefaultRunBudget;
  const activeInvocations = new Map<string, AbortController>();

  async function project(aggregate: TaskAggregate): Promise<void> {
    try {
      await options.scratchpad.put(projectAggregate(aggregate));
    } catch (error) {
      observer.warning(error, {
        operation: 'scratchpad_projection',
        taskId: aggregate.task.id,
        runId: aggregate.run.id,
        aggregateVersion: aggregate.version,
      });
    }
  }

  async function update(
    principalId: string,
    taskId: string,
    transition: (aggregate: TaskAggregate) => boolean,
  ): Promise<{ aggregate: TaskAggregate; changed: boolean }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await options.store.findByTaskId(principalId, taskId);
      if (current === null) {
        throw new LifecycleError(
          `Task ${taskId} was not found.`,
          'task_not_found',
        );
      }

      const next = structuredClone(current);
      if (!transition(next)) {
        return { aggregate: current, changed: false };
      }
      next.version = current.version + 1;
      const validated = TaskAggregateSchema.parse(next);
      if (await options.store.replace(validated, current.version)) {
        await project(validated);
        return { aggregate: validated, changed: true };
      }
    }

    throw new LifecycleError(
      `Task ${taskId} changed too frequently to apply the transition.`,
      'concurrent_transition_failed',
    );
  }

  async function recordDecision(
    aggregate: TaskAggregate,
    decision: DecisionResult,
    approvedContext?: { project: Project; context: ProjectContextBundle },
  ): Promise<TaskAggregate> {
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

        if (approvedContext === undefined) {
          throw new Error('Approved project context was not assembled.');
        }
        candidate.run.status = 'awaiting_approval';
        candidate.run.context = approvedContext.context;
        candidate.run.approval = {
          id: approvalId,
          status: 'pending',
          reason: decision.decision.reason,
          capability: decision.decision.capability,
          proposedArguments: decision.decision.proposedArguments,
          project: {
            id: approvedContext.project.id,
            displayName: approvedContext.project.displayName,
          },
          contextManifest: approvedContext.context.manifest,
          destination: options.developmentPlanning.selected().destination,
          requestedAt: now,
        };
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
      const decision = await options.evaluateModelDecision(
        budgetClaim.aggregate.task.message,
        selectedProject === undefined || selectedProject === null
          ? undefined
          : {
              selectedProject: {
                id: selectedProject.id,
                displayName: selectedProject.displayName,
              },
            },
      );
      if (decision.decision.kind !== 'approval_required') {
        return await recordDecision(budgetClaim.aggregate, decision);
      }
      if (selectedProjectId === undefined) {
        return await recordFailure(
          budgetClaim.aggregate.task.principalId,
          budgetClaim.aggregate.task.id,
          'project_required',
          'A registered projectId is required for development planning.',
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
      let context: ProjectContextBundle;
      try {
        context = await options.contextAssembler.assemble({
          project: selectedProject,
          objective: decision.decision.proposedArguments.objective,
          ticket: decision.decision.proposedArguments.ticket,
          limits: {
            maxFiles: runBudget.limits.maxContextFiles,
            maxBytes: runBudget.limits.maxContextBytes,
            maxFileBytes: runBudget.limits.maxContextFileBytes,
          },
        });
        assertProjectContextIntegrity(context, selectedProject.id);
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
          : 'internal_failure',
        error instanceof ModelProviderError
          ? 'The model provider could not decide how to handle this task.'
          : 'Vera could not decide how to handle this task.',
        'run_failed',
      );
    }
  }

  async function executeApproved(
    aggregate: TaskAggregate,
    resumeExistingInvocation: boolean,
  ): Promise<TaskAggregate> {
    const invocationId = createId('invocation');
    const now = clock();
    const claim = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        if (
          candidate.run.status !== 'awaiting_approval' ||
          candidate.run.approval?.status !== 'approved'
        ) {
          return false;
        }
        candidate.run.budget ??= structuredClone(budget);
        const elapsed = Date.parse(now) - Date.parse(candidate.run.createdAt);
        if (
          candidate.run.budget.consumed.capabilityInvocations >=
            candidate.run.budget.limits.capabilityInvocations ||
          elapsed >= candidate.run.budget.limits.maxDurationMs
        ) {
          candidate.run.status = 'failed';
          candidate.task.status = 'failed';
          candidate.run.failure = {
            code: 'budget_exhausted',
            message:
              'The run exhausted its capability-invocation or duration budget.',
          };
          appendEvent(
            candidate,
            'budget_exhausted',
            now,
            { resource: 'capability_invocations_or_duration' },
            createId,
          );
          appendEvent(
            candidate,
            'run_failed',
            now,
            { code: 'budget_exhausted' },
            createId,
          );
          return true;
        }
        candidate.run.budget.consumed.capabilityInvocations += 1;
        candidate.run.status = 'executing';
        candidate.run.updatedAt = now;
        candidate.task.updatedAt = now;
        candidate.run.invocation = {
          id: invocationId,
          status: 'executing',
          capability: candidate.run.approval.capability,
          arguments: candidate.run.approval.proposedArguments,
          ...(candidate.run.approval.project === undefined
            ? {}
            : { project: candidate.run.approval.project }),
          ...(candidate.run.approval.contextManifest === undefined
            ? {}
            : { contextManifest: candidate.run.approval.contextManifest }),
          ...(candidate.run.approval.destination === undefined
            ? {}
            : { destination: candidate.run.approval.destination }),
          startedAt: now,
        };
        appendEvent(
          candidate,
          'budget_consumed',
          now,
          {
            resource: 'capability_invocations',
            consumed: candidate.run.budget.consumed.capabilityInvocations,
            limit: candidate.run.budget.limits.capabilityInvocations,
          },
          createId,
        );
        appendEvent(
          candidate,
          'capability_invocation_started',
          now,
          { invocationId },
          createId,
        );
        return true;
      },
    );

    const claimedInvocation = claim.aggregate.run.invocation;
    if (claimedInvocation === undefined) {
      return claim.aggregate;
    }
    // Only the caller that won the awaiting-approval transition executes fresh
    // work. Startup recovery is the one exception: it may resume the already
    // persisted invocation ID without writing a second start event.
    const freshlyClaimed =
      claim.changed && claimedInvocation.id === invocationId;
    const resumingInterruptedInvocation =
      !claim.changed &&
      resumeExistingInvocation &&
      claim.aggregate.run.status === 'executing' &&
      claimedInvocation.status === 'executing';
    const shouldExecute = freshlyClaimed || resumingInterruptedInvocation;
    if (!shouldExecute) {
      return claim.aggregate;
    }

    const completeWithArtifact = async (
      artifact: Artifact,
    ): Promise<TaskAggregate> => {
      const completedAt = clock();
      const completion = await update(
        claim.aggregate.task.principalId,
        claim.aggregate.task.id,
        (candidate) => {
          if (
            !['executing', 'cancellation_requested'].includes(
              candidate.run.status,
            ) ||
            candidate.run.invocation?.id !== claimedInvocation.id ||
            candidate.run.invocation.status !== 'executing'
          ) {
            return false;
          }
          candidate.run.status = 'succeeded';
          candidate.task.status = 'completed';
          candidate.run.updatedAt = completedAt;
          candidate.task.updatedAt = completedAt;
          candidate.run.invocation.status = 'succeeded';
          candidate.run.invocation.completedAt = completedAt;
          const { destination: ignoredDestination, ...producerModel } =
            artifact.producer;
          void ignoredDestination;
          candidate.run.invocation.model = producerModel;
          candidate.run.output = {
            kind: 'development_plan',
            plan: artifact.content,
            artifact: {
              id: artifact.id,
              version: artifact.version,
              type: artifact.type,
              mediaType: artifact.mediaType,
              sha256: artifact.sha256,
              byteLength: artifact.byteLength,
            },
          };
          appendEvent(
            candidate,
            'artifact_created',
            completedAt,
            { artifactId: artifact.id, invocationId: claimedInvocation.id },
            createId,
          );
          appendEvent(
            candidate,
            'capability_invocation_succeeded',
            completedAt,
            { invocationId: claimedInvocation.id },
            createId,
          );
          appendEvent(candidate, 'run_succeeded', completedAt, {}, createId);
          return true;
        },
      );
      return completion.aggregate;
    };

    try {
      const existingArtifact =
        await options.resources.findArtifactByInvocationId(
          claim.aggregate.task.principalId,
          claimedInvocation.id,
        );
      if (existingArtifact !== null) {
        const approvedDestination = claim.aggregate.run.approval?.destination;
        if (
          existingArtifact.taskId !== claim.aggregate.task.id ||
          existingArtifact.runId !== claim.aggregate.run.id ||
          existingArtifact.projectId !== claimedInvocation.project?.id ||
          (existingArtifact.producer.destination !== undefined &&
            approvedDestination !== undefined &&
            !sameCapabilityDestination(
              existingArtifact.producer.destination,
              approvedDestination,
            ))
        ) {
          throw new Error(
            'The idempotent artifact belongs to a different invocation context.',
          );
        }
        return await completeWithArtifact(existingArtifact);
      }
      let executionAggregate = claim.aggregate;
      if (resumingInterruptedInvocation) {
        const retryAt = clock();
        const retryClaim = await update(
          claim.aggregate.task.principalId,
          claim.aggregate.task.id,
          (candidate) => {
            if (
              candidate.run.status !== 'executing' ||
              candidate.run.invocation?.id !== claimedInvocation.id
            ) {
              return false;
            }
            candidate.run.budget ??= structuredClone(budget);
            if (
              candidate.run.budget.consumed.retries >=
              candidate.run.budget.limits.retries
            ) {
              candidate.run.status = 'failed';
              candidate.task.status = 'failed';
              candidate.run.failure = {
                code: 'budget_exhausted',
                message: 'The run exhausted its recovery retry budget.',
              };
              candidate.run.invocation.status = 'failed';
              candidate.run.invocation.completedAt = retryAt;
              candidate.run.updatedAt = retryAt;
              candidate.task.updatedAt = retryAt;
              appendEvent(
                candidate,
                'budget_exhausted',
                retryAt,
                { resource: 'retries' },
                createId,
              );
              appendEvent(
                candidate,
                'run_failed',
                retryAt,
                { code: 'budget_exhausted' },
                createId,
              );
              return true;
            }
            candidate.run.budget.consumed.retries += 1;
            candidate.run.updatedAt = retryAt;
            candidate.task.updatedAt = retryAt;
            appendEvent(
              candidate,
              'budget_consumed',
              retryAt,
              {
                resource: 'retries',
                consumed: candidate.run.budget.consumed.retries,
                limit: candidate.run.budget.limits.retries,
              },
              createId,
            );
            return true;
          },
        );
        if (retryClaim.aggregate.run.status !== 'executing') {
          return retryClaim.aggregate;
        }
        executionAggregate = retryClaim.aggregate;
      }
      const context = executionAggregate.run.context;
      const projectReference = claimedInvocation.project;
      const runBudget = executionAggregate.run.budget;
      const approvedDestination = executionAggregate.run.approval?.destination;
      if (
        context === undefined ||
        projectReference === undefined ||
        runBudget === undefined ||
        approvedDestination === undefined
      ) {
        throw new Error(
          'The approved invocation is missing authoritative project context, destination, or limits.',
        );
      }
      if (
        claimedInvocation.destination !== undefined &&
        !sameCapabilityDestination(
          claimedInvocation.destination,
          approvedDestination,
        )
      ) {
        throw new Error(
          'The claimed invocation destination differs from the approved destination.',
        );
      }
      const developmentPlanning =
        options.developmentPlanning.resolve(approvedDestination);
      if (developmentPlanning === null) {
        throw new Error(
          `The approved planning adapter ${approvedDestination.adapterId} is unavailable or its destination configuration changed.`,
        );
      }
      assertProjectContextIntegrity(context, projectReference.id);
      const elapsedBeforeInvocation =
        Date.parse(clock()) - Date.parse(executionAggregate.run.createdAt);
      const remainingDurationMs =
        runBudget.limits.maxDurationMs - elapsedBeforeInvocation;
      if (remainingDurationMs <= 0) {
        const exhaustedAt = clock();
        const exhausted = await update(
          executionAggregate.task.principalId,
          executionAggregate.task.id,
          (candidate) => {
            if (
              candidate.run.status !== 'executing' ||
              candidate.run.invocation?.id !== claimedInvocation.id
            ) {
              return false;
            }
            candidate.run.status = 'failed';
            candidate.task.status = 'failed';
            candidate.run.failure = {
              code: 'budget_exhausted',
              message: 'The run exhausted its duration budget.',
            };
            candidate.run.invocation.status = 'failed';
            candidate.run.invocation.completedAt = exhaustedAt;
            candidate.run.updatedAt = exhaustedAt;
            candidate.task.updatedAt = exhaustedAt;
            appendEvent(
              candidate,
              'budget_exhausted',
              exhaustedAt,
              { resource: 'duration' },
              createId,
            );
            appendEvent(
              candidate,
              'run_failed',
              exhaustedAt,
              { code: 'budget_exhausted' },
              createId,
            );
            return true;
          },
        );
        return exhausted.aggregate;
      }
      const controller = new AbortController();
      activeInvocations.set(claimedInvocation.id, controller);
      const latestBeforeInvocation = await options.store.findByTaskId(
        executionAggregate.task.principalId,
        executionAggregate.task.id,
      );
      if (latestBeforeInvocation?.run.status === 'cancellation_requested') {
        controller.abort();
      }
      const result = await developmentPlanning.execute(
        {
          schemaVersion: 1,
          invocationId: claimedInvocation.id,
          arguments: claimedInvocation.arguments,
          project: projectReference,
          context,
          limits: {
            maxDurationMs: remainingDurationMs,
            maxArtifactBytes: runBudget.limits.maxArtifactBytes,
          },
        },
        { signal: controller.signal },
      );
      if (
        result.plan.project.id !== projectReference.id ||
        result.plan.project.name !== projectReference.displayName ||
        result.plan.project.revision !== context.manifest.revision ||
        result.plan.objective !== claimedInvocation.arguments.objective ||
        result.plan.ticket.reference !==
          claimedInvocation.arguments.ticket.reference ||
        result.plan.ticket.details !==
          claimedInvocation.arguments.ticket.details
      ) {
        throw new Error(
          'The capability result did not preserve authoritative invocation identity.',
        );
      }
      const contentJson = JSON.stringify(result.plan);
      const artifact = ArtifactSchema.parse({
        schemaVersion: 1,
        id: `artifact_${claimedInvocation.id.slice('invocation_'.length)}`,
        version: 1,
        principalId: claim.aggregate.task.principalId,
        taskId: claim.aggregate.task.id,
        runId: claim.aggregate.run.id,
        invocationId: claimedInvocation.id,
        projectId: projectReference.id,
        type: 'implementation_plan',
        mediaType: 'application/vnd.vera.implementation-plan+json',
        sha256: createHash('sha256').update(contentJson).digest('hex'),
        byteLength: Buffer.byteLength(contentJson),
        producer: {
          destination: approvedDestination,
          ...result.model,
        },
        content: result.plan,
        createdAt: clock(),
      });
      if (artifact.byteLength > runBudget.limits.maxArtifactBytes) {
        throw new Error(
          'The development plan exceeded the artifact byte limit.',
        );
      }
      const storedArtifact = await options.resources.createArtifact(artifact);
      if (
        storedArtifact.artifact.taskId !== claim.aggregate.task.id ||
        storedArtifact.artifact.runId !== claim.aggregate.run.id ||
        storedArtifact.artifact.projectId !== projectReference.id
      ) {
        throw new Error(
          'The stored artifact belongs to a different invocation context.',
        );
      }
      return await completeWithArtifact(storedArtifact.artifact);
    } catch (error) {
      observer.warning(error, {
        operation: 'capability_execution',
        taskId: claim.aggregate.task.id,
        runId: claim.aggregate.run.id,
        invocationId: claimedInvocation.id,
      });
      const current = await options.store.findByTaskId(
        claim.aggregate.task.principalId,
        claim.aggregate.task.id,
      );
      if (current?.run.status === 'cancellation_requested') {
        const cancelledAt = clock();
        const cancellation = await update(
          current.task.principalId,
          current.task.id,
          (candidate) => {
            if (candidate.run.status !== 'cancellation_requested') return false;
            candidate.run.status = 'cancelled';
            candidate.task.status = 'cancelled';
            candidate.run.updatedAt = cancelledAt;
            candidate.task.updatedAt = cancelledAt;
            if (candidate.run.invocation?.status === 'executing') {
              candidate.run.invocation.status = 'failed';
              candidate.run.invocation.completedAt = cancelledAt;
            }
            candidate.run.failure = {
              code: 'cancelled',
              message: 'The run was cancelled before the capability completed.',
            };
            appendEvent(
              candidate,
              'run_cancelled',
              cancelledAt,
              { invocationId: claimedInvocation.id },
              createId,
            );
            return true;
          },
        );
        return cancellation.aggregate;
      }
      return await recordFailure(
        claim.aggregate.task.principalId,
        claim.aggregate.task.id,
        'capability_execution_failure',
        'The development planning capability could not complete the task.',
        'capability_invocation_failed',
      );
    } finally {
      activeInvocations.delete(claimedInvocation.id);
    }
  }

  return {
    async submit(input) {
      const now = clock();
      const taskId = createId('task');
      const runId = createId('run');
      const aggregate: TaskAggregate = {
        schemaVersion: 1,
        version: 1,
        task: {
          id: taskId,
          requestKey: input.requestKey,
          principalId: input.principalId,
          ...(input.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          ...(input.conversationId === undefined
            ? {}
            : { conversationId: input.conversationId }),
          ...(input.messageId === undefined
            ? {}
            : { messageId: input.messageId }),
          message: input.message,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        run: {
          id: runId,
          status: 'deciding',
          createdAt: now,
          updatedAt: now,
          budget: structuredClone(budget),
        },
        events: [
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 1,
            type: 'task_created',
            occurredAt: now,
            data: {},
          },
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 2,
            type: 'run_started',
            occurredAt: now,
            data: { runId },
          },
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 3,
            type: 'budget_assigned',
            occurredAt: now,
            data: { limits: budget.limits },
          },
        ],
      };
      const creation = await options.store.create(
        TaskAggregateSchema.parse(aggregate),
      );
      await project(creation.aggregate);
      if (
        !creation.created &&
        (creation.aggregate.task.message !== input.message ||
          creation.aggregate.task.principalId !== input.principalId ||
          creation.aggregate.task.projectId !== input.projectId ||
          creation.aggregate.task.conversationId !== input.conversationId ||
          creation.aggregate.task.messageId !== input.messageId)
      ) {
        throw new LifecycleError(
          `Idempotency key ${input.requestKey} is already associated with different task input.`,
          'idempotency_key_reused',
        );
      }
      if (!creation.created) {
        return creation.aggregate;
      }
      return evaluate(creation.aggregate);
    },

    async getTask(principalId, taskId) {
      const aggregate = await options.store.findByTaskId(principalId, taskId);
      if (aggregate === null) {
        throw new LifecycleError(
          `Task ${taskId} was not found.`,
          'task_not_found',
        );
      }
      // Polling reads intentionally perform one idempotent, newer-version-only
      // Redis projection. Current projections are not mutated; missing or stale
      // scratchpads self-heal from MongoDB authority.
      await project(aggregate);
      return aggregate;
    },

    async getRun(principalId, runId) {
      const aggregate = await options.store.findByRunId(principalId, runId);
      if (aggregate === null) {
        throw new LifecycleError(
          `Run ${runId} was not found.`,
          'run_not_found',
        );
      }
      // See getTask: read repair is deliberate so losing Redis never requires a
      // separate reconciliation operation before a client can continue.
      await project(aggregate);
      return aggregate;
    },

    async decideApproval(input) {
      const existing = await options.store.findByApprovalId(
        input.principalId,
        input.approvalId,
      );
      if (existing === null) {
        throw new LifecycleError(
          `Approval ${input.approvalId} was not found.`,
          'approval_not_found',
        );
      }
      const currentStatus = existing.run.approval?.status;
      if (currentStatus !== 'pending') {
        if (currentStatus !== input.decision) {
          throw new LifecycleError(
            `Approval ${input.approvalId} has already been ${String(currentStatus)}.`,
            'approval_already_decided',
          );
        }
        return currentStatus === 'approved'
          ? executeApproved(existing, false)
          : existing;
      }

      const decidedAt = clock();
      const decision = await update(
        input.principalId,
        existing.task.id,
        (aggregate) => {
          if (aggregate.run.approval?.status !== 'pending') {
            return false;
          }
          aggregate.run.approval.status = input.decision;
          aggregate.run.approval.decidedAt = decidedAt;
          aggregate.run.approval.decidedBy = input.principalId;
          aggregate.run.updatedAt = decidedAt;
          aggregate.task.updatedAt = decidedAt;
          appendEvent(
            aggregate,
            input.decision === 'approved'
              ? 'approval_approved'
              : 'approval_rejected',
            decidedAt,
            { approvalId: input.approvalId, principalId: input.principalId },
            createId,
          );
          if (input.decision === 'rejected') {
            aggregate.run.status = 'rejected';
            aggregate.task.status = 'rejected';
            appendEvent(
              aggregate,
              'run_rejected',
              decidedAt,
              { reason: 'approval_rejected' },
              createId,
            );
          }
          return true;
        },
      );
      if (decision.aggregate.run.approval?.status !== input.decision) {
        throw new LifecycleError(
          `Approval ${input.approvalId} has already been ${String(decision.aggregate.run.approval?.status)}.`,
          'approval_already_decided',
        );
      }
      return input.decision === 'approved'
        ? executeApproved(decision.aggregate, false)
        : decision.aggregate;
    },

    async cancelRun(input) {
      const existing = await options.store.findByRunId(
        input.principalId,
        input.runId,
      );
      if (existing === null) {
        throw new LifecycleError(
          `Run ${input.runId} was not found.`,
          'run_not_found',
        );
      }
      if (
        ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
          existing.run.status,
        )
      ) {
        return existing;
      }
      const requestedAt = clock();
      const cancellation = await update(
        input.principalId,
        existing.task.id,
        (aggregate) => {
          if (
            ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
              aggregate.run.status,
            )
          ) {
            return false;
          }
          const wasExecuting = aggregate.run.status === 'executing';
          aggregate.run.status = wasExecuting
            ? 'cancellation_requested'
            : 'cancelled';
          aggregate.task.status = wasExecuting ? 'active' : 'cancelled';
          aggregate.run.updatedAt = requestedAt;
          aggregate.task.updatedAt = requestedAt;
          if (aggregate.run.approval?.status === 'pending') {
            aggregate.run.approval.status = 'rejected';
            aggregate.run.approval.decidedAt = requestedAt;
            aggregate.run.approval.decidedBy = input.principalId;
            appendEvent(
              aggregate,
              'approval_rejected',
              requestedAt,
              {
                approvalId: aggregate.run.approval.id,
                reason: 'run_cancelled',
              },
              createId,
            );
          }
          appendEvent(
            aggregate,
            'cancellation_requested',
            requestedAt,
            { principalId: input.principalId },
            createId,
          );
          if (!wasExecuting) {
            aggregate.run.failure = {
              code: 'cancelled',
              message: 'The run was cancelled before capability execution.',
            };
            appendEvent(aggregate, 'run_cancelled', requestedAt, {}, createId);
          }
          return true;
        },
      );
      const invocationId = cancellation.aggregate.run.invocation?.id;
      if (invocationId !== undefined) {
        activeInvocations.get(invocationId)?.abort();
      }
      return cancellation.aggregate;
    },

    async recoverInterrupted() {
      const aggregates = await options.store.findRecoverable();
      for (const aggregate of aggregates) {
        await project(aggregate);
        if (aggregate.run.status === 'cancellation_requested') {
          const cancelledAt = clock();
          await update(
            aggregate.task.principalId,
            aggregate.task.id,
            (candidate) => {
              if (candidate.run.status !== 'cancellation_requested') {
                return false;
              }
              candidate.run.status = 'cancelled';
              candidate.task.status = 'cancelled';
              candidate.run.updatedAt = cancelledAt;
              candidate.task.updatedAt = cancelledAt;
              if (candidate.run.invocation?.status === 'executing') {
                candidate.run.invocation.status = 'failed';
                candidate.run.invocation.completedAt = cancelledAt;
              }
              candidate.run.failure = {
                code: 'cancelled',
                message: 'The interrupted run was cancelled during recovery.',
              };
              appendEvent(
                candidate,
                'run_cancelled',
                cancelledAt,
                { reason: 'recovered_cancellation_request' },
                createId,
              );
              return true;
            },
          );
          continue;
        }
        if (aggregate.run.status === 'deciding') {
          await evaluate(aggregate);
          continue;
        }
        await executeApproved(aggregate, aggregate.run.status === 'executing');
      }
    },
  };
}
