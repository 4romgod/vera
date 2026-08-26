import { createHash, randomUUID } from 'node:crypto';

import { assembleConversationContext } from '../conversations/assemble-conversation-context.ts';
import type { EvaluateModelDecision } from '../model-decisions/evaluate-model-decision.ts';
import { assertConversationContextIntegrity } from '../conversations/validate-conversation-context.ts';
import { assertProjectContextIntegrity } from '../projects/validate-project-context.ts';
import type { DecisionResult } from '../../domain/model/execution-decision.ts';
import {
  ArtifactReferenceSchema,
  ArtifactSchema,
  type Artifact,
} from '../../domain/artifacts/artifact.ts';
import { sameCapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type { CapabilityAuthority } from '../../domain/capabilities/capability-registry.ts';
import type {
  ConversationContextBundle,
  ConversationContextLimits,
} from '../../domain/conversations/conversation-context.ts';
import { ConversationMessageSchema } from '../../domain/conversations/conversation.ts';
import type { Project } from '../../domain/projects/project.ts';
import type { ProjectContextBundle } from '../../domain/projects/project-context.ts';
import {
  DefaultRunBudget,
  type RunBudget,
} from '../../domain/tasks/run-budget.ts';
import {
  ApprovalSchema,
  CapabilityInvocationSchema,
  TaskAggregateSchema,
  type TaskAggregate,
  type TaskEventType,
} from '../../domain/tasks/task-aggregate.ts';
import { ModelProviderError } from '../../ports/model/model-provider.ts';
import type { CapabilityRuntimeRegistry } from '../../ports/capabilities/capability-runtime.ts';
import type { ExecutionStore } from '../../ports/persistence/execution-store.ts';
import type { ProjectContextAssembler } from '../../ports/projects/project-context-assembler.ts';
import type { OwnerResourceStore } from '../../ports/persistence/owner-resource-store.ts';
import type { Scratchpad } from '../../ports/persistence/scratchpad.ts';
import { projectTaskScratchpad } from './project-task-scratchpad.ts';

export type LifecycleErrorCode =
  | 'task_not_found'
  | 'run_not_found'
  | 'approval_not_found'
  | 'approval_already_decided'
  | 'idempotency_key_reused'
  | 'project_required'
  | 'project_not_found'
  | 'conversation_not_found'
  | 'conversation_message_not_found'
  | 'conversation_message_mismatch'
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
  progressTask(principalId: string, taskId: string): Promise<TaskAggregate>;
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
  capabilities: CapabilityRuntimeRegistry;
  resources: OwnerResourceStore;
  contextAssembler: ProjectContextAssembler;
  conversationContextLimits?: ConversationContextLimits;
  budget?: RunBudget;
  executionMode?: 'inline' | 'worker';
  observer?: LifecycleObserver;
  clock?: Clock;
  createId?: IdFactory;
}): TaskLifecycle {
  const observer = options.observer ?? defaultObserver;
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const budget = options.budget ?? DefaultRunBudget;
  const executionMode = options.executionMode ?? 'inline';
  const conversationContextLimits = options.conversationContextLimits ?? {
    maxMessages: 20,
    maxCharacters: 40_000,
  };
  const activeInvocations = new Map<string, AbortController>();

  function artifactReference(artifact: Artifact) {
    return ArtifactReferenceSchema.parse({
      id: artifact.id,
      version: artifact.version,
      type: artifact.type,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
    });
  }

  function artifactContentIsIntact(artifact: Artifact): boolean {
    const contentJson = JSON.stringify(artifact.content);
    return (
      createHash('sha256').update(contentJson).digest('hex') ===
        artifact.sha256 &&
      Buffer.byteLength(contentJson) === artifact.byteLength
    );
  }

  function sameArtifactReferences(
    left: Artifact['inputs'],
    right: Artifact['inputs'],
  ): boolean {
    const leftReferences = left ?? [];
    const rightReferences = right ?? [];
    return (
      leftReferences.length === rightReferences.length &&
      leftReferences.every((reference, index) => {
        const other = rightReferences[index];
        return (
          reference.id === other?.id &&
          reference.type === other.type &&
          reference.mediaType === other.mediaType &&
          reference.sha256 === other.sha256 &&
          reference.byteLength === other.byteLength
        );
      })
    );
  }

  function authorityIsWithin(
    effective: CapabilityAuthority,
    maximum: CapabilityAuthority,
  ): boolean {
    return (
      effective.projectContext === maximum.projectContext &&
      effective.networkAccess === maximum.networkAccess &&
      effective.credentials === maximum.credentials &&
      effective.maxWebSearchCalls === maximum.maxWebSearchCalls &&
      effective.dataClasses.every((value) =>
        maximum.dataClasses.includes(value),
      ) &&
      effective.sideEffects.every((value) =>
        maximum.sideEffects.includes(value),
      )
    );
  }

  function sameAuthority(
    left: CapabilityAuthority,
    right: CapabilityAuthority,
  ): boolean {
    return (
      left.projectContext === right.projectContext &&
      left.networkAccess === right.networkAccess &&
      left.credentials === right.credentials &&
      left.maxWebSearchCalls === right.maxWebSearchCalls &&
      left.dataClasses.length === right.dataClasses.length &&
      left.sideEffects.length === right.sideEffects.length &&
      left.dataClasses.every((value) => right.dataClasses.includes(value)) &&
      left.sideEffects.every((value) => right.sideEffects.includes(value))
    );
  }

  function setCurrentGoalStepStatus(
    aggregate: TaskAggregate,
    status: 'rejected' | 'failed' | 'cancelled',
  ): void {
    const goal = aggregate.run.goal;
    const step = goal?.steps[goal.currentStepIndex];
    if (
      step !== undefined &&
      !['succeeded', 'rejected', 'failed', 'cancelled'].includes(step.status)
    ) {
      step.status = status;
    }
  }

  function archiveCurrentGoalBoundary(aggregate: TaskAggregate): void {
    if (aggregate.run.approval !== undefined) {
      aggregate.run.approvalHistory ??= [];
      if (
        !aggregate.run.approvalHistory.some(
          (approval) => approval.id === aggregate.run.approval?.id,
        )
      ) {
        aggregate.run.approvalHistory.push(
          structuredClone(aggregate.run.approval),
        );
      }
    }
    if (aggregate.run.invocation !== undefined) {
      aggregate.run.invocationHistory ??= [];
      if (
        !aggregate.run.invocationHistory.some(
          (invocation) => invocation.id === aggregate.run.invocation?.id,
        )
      ) {
        aggregate.run.invocationHistory.push(
          structuredClone(aggregate.run.invocation),
        );
      }
    }
  }

  function prepareGoalStepApproval(
    aggregate: TaskAggregate,
    stepIndex: number,
    requestedAt: string,
  ): void {
    const goal = aggregate.run.goal;
    const step = goal?.steps[stepIndex];
    if (goal === undefined || step === undefined) {
      throw new Error('The goal does not contain the requested step.');
    }
    const runtime = options.capabilities.selected({
      name: step.capability,
      version: step.version,
    });
    if (runtime === null) {
      throw new Error(
        `Goal capability ${step.capability}@${String(step.version)} is unavailable.`,
      );
    }
    const inputs = step.inputStepIds.map((inputStepId) => {
      const dependency = goal.steps.find(
        (candidate) => candidate.id === inputStepId,
      );
      if (dependency?.artifact === undefined) {
        throw new Error(
          `Goal step ${step.id} is missing completed input ${inputStepId}.`,
        );
      }
      return dependency.artifact;
    });
    const requiresProject = runtime.authority.projectContext === 'required';
    if (
      requiresProject &&
      (aggregate.task.projectId === undefined ||
        aggregate.run.context === undefined ||
        goal.project === undefined)
    ) {
      throw new Error(`Goal step ${step.id} requires project context.`);
    }
    const approvalId = createId('approval');
    const authority = runtime.authorityFor({
      arguments: step.arguments,
      hasInputArtifacts: inputs.length > 0,
    });
    if (!authorityIsWithin(authority, runtime.authority)) {
      throw new Error(`Goal step ${step.id} resolved invalid authority.`);
    }
    aggregate.run.approval = ApprovalSchema.parse({
      id: approvalId,
      status: 'pending',
      reason: 'specialist_capability_invocation',
      capability: { name: step.capability, version: step.version },
      proposedArguments: step.arguments,
      ...(requiresProject
        ? {
            project: {
              id: goal.project?.id,
              displayName: goal.project?.displayName,
            },
            contextManifest: aggregate.run.context?.manifest,
          }
        : {}),
      ...(inputs.length === 0 ? {} : { inputArtifacts: inputs }),
      destination: runtime.destination,
      authority,
      requestedAt,
    });
    step.status = 'awaiting_approval';
    step.approvalId = approvalId;
    goal.currentStepIndex = stepIndex;
    aggregate.run.status = 'awaiting_approval';
    delete aggregate.run.invocation;
    delete aggregate.run.output;
    appendEvent(
      aggregate,
      'goal_step_awaiting_approval',
      requestedAt,
      {
        goalStepId: step.id,
        approvalId,
        capability: `${step.capability}@${String(step.version)}`,
        inputArtifactIds: inputs.map((artifact) => artifact.id),
      },
      createId,
    );
    appendEvent(
      aggregate,
      'approval_requested',
      requestedAt,
      {
        approvalId,
        capability: `${step.capability}@${String(step.version)}`,
        goalStepId: step.id,
      },
      createId,
    );
  }

  function conversationReplyContent(aggregate: TaskAggregate): string {
    if (aggregate.run.output?.kind === 'response') {
      return aggregate.run.output.message;
    }
    if (aggregate.run.output?.kind === 'development_plan') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        `I created the implementation plan "${aggregate.run.output.plan.title}".`,
        aggregate.run.output.plan.summary,
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'software_change') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        `I created a reviewable software change affecting ${String(aggregate.run.output.change.files.length)} file(s).`,
        aggregate.run.output.change.summary,
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'research_report') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        `I completed source-backed web research with ${String(aggregate.run.output.report.sources.length)} source(s).`,
        aggregate.run.output.report.report,
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'personal_task_result') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        aggregate.run.output.result.summary,
        ...aggregate.run.output.result.tasks.map(
          (task) =>
            `${task.status === 'completed' ? '[completed]' : '[open]'} ${task.title} (${task.id})`,
        ),
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'goal_result') {
      return [
        `I completed the goal through ${String(aggregate.run.output.artifacts.length)} approved capability steps.`,
        aggregate.run.output.summary,
        `Artifacts: ${aggregate.run.output.artifacts.map((artifact) => artifact.id).join(', ')}`,
      ].join('\n\n');
    }
    if (aggregate.run.failure !== undefined) {
      return aggregate.run.failure.message;
    }
    if (
      aggregate.run.status === 'rejected' &&
      aggregate.run.decision?.decision.kind === 'rejected'
    ) {
      return aggregate.run.decision.decision.message;
    }
    if (aggregate.run.status === 'rejected') {
      return 'The requested specialist invocation was not approved.';
    }
    return 'The request reached a terminal state without a response.';
  }

  function requiresConversationReplyProjection(
    aggregate: TaskAggregate,
  ): boolean {
    return (
      aggregate.task.conversationId !== undefined &&
      aggregate.task.messageId !== undefined &&
      aggregate.run.conversationReply === undefined &&
      ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
        aggregate.run.status,
      )
    );
  }

  function addConversationReplyProjection(
    aggregate: TaskAggregate,
    eventAt: string,
  ): void {
    const suffix = aggregate.task.id.slice('task_'.length);
    aggregate.run.conversationReply = {
      status: 'pending',
      messageId: `message_reply_${suffix}`,
      requestKey: `vera-reply:${aggregate.task.id}`,
      content: conversationReplyContent(aggregate),
      createdAt: aggregate.run.updatedAt,
    };
    appendEvent(
      aggregate,
      'conversation_reply_pending',
      eventAt,
      { messageId: aggregate.run.conversationReply.messageId },
      createId,
    );
  }

  function ensureConversationReplyProjection(aggregate: TaskAggregate): void {
    if (requiresConversationReplyProjection(aggregate)) {
      addConversationReplyProjection(aggregate, aggregate.run.updatedAt);
    }
  }

  async function project(aggregate: TaskAggregate): Promise<void> {
    try {
      await options.scratchpad.put(projectTaskScratchpad(aggregate));
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
      ensureConversationReplyProjection(next);
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

  async function prepareConversationContext(input: {
    principalId: string;
    message: string;
    projectId?: string;
    conversationId?: string;
    messageId?: string;
  }): Promise<ConversationContextBundle | undefined> {
    if (input.conversationId === undefined && input.messageId === undefined) {
      return undefined;
    }
    if (input.conversationId === undefined || input.messageId === undefined) {
      throw new LifecycleError(
        'A conversation task requires both conversationId and messageId.',
        'conversation_message_mismatch',
      );
    }
    const conversation = await options.resources.findConversationById(
      input.principalId,
      input.conversationId,
    );
    if (conversation === null) {
      throw new LifecycleError(
        `Conversation ${input.conversationId} was not found.`,
        'conversation_not_found',
      );
    }
    const currentMessage = conversation.messages.find(
      (message) => message.id === input.messageId,
    );
    if (currentMessage === undefined) {
      throw new LifecycleError(
        `Message ${input.messageId} was not found in conversation ${input.conversationId}.`,
        'conversation_message_not_found',
      );
    }
    if (
      currentMessage.role !== 'owner' ||
      currentMessage.content !== input.message ||
      currentMessage.projectId !== input.projectId
    ) {
      throw new LifecycleError(
        'The conversation message does not match the submitted task input.',
        'conversation_message_mismatch',
      );
    }
    return assembleConversationContext({
      conversation,
      throughMessageId: currentMessage.id,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      limits: conversationContextLimits,
    });
  }

  function assertMatchingTaskInput(
    aggregate: TaskAggregate,
    input: Parameters<TaskLifecycle['submit']>[0],
  ): void {
    if (
      aggregate.task.message !== input.message ||
      aggregate.task.principalId !== input.principalId ||
      aggregate.task.projectId !== input.projectId ||
      aggregate.task.conversationId !== input.conversationId ||
      aggregate.task.messageId !== input.messageId
    ) {
      throw new LifecycleError(
        `Idempotency key ${input.requestKey} is already associated with different task input.`,
        'idempotency_key_reused',
      );
    }
  }

  async function projectConversationReply(
    aggregate: TaskAggregate,
  ): Promise<TaskAggregate> {
    const projection = aggregate.run.conversationReply;
    const conversationId = aggregate.task.conversationId;
    if (projection?.status !== 'pending' || conversationId === undefined) {
      return aggregate;
    }
    const message = ConversationMessageSchema.parse({
      id: projection.messageId,
      requestKey: projection.requestKey,
      role: 'vera',
      content: projection.content,
      ...(aggregate.task.projectId === undefined
        ? {}
        : { projectId: aggregate.task.projectId }),
      taskId: aggregate.task.id,
      createdAt: projection.createdAt,
    });
    const appended = await options.resources.appendMessage(
      aggregate.task.principalId,
      conversationId,
      message,
    );
    if (
      appended.message.id !== message.id ||
      appended.message.role !== message.role ||
      appended.message.content !== message.content ||
      appended.message.projectId !== message.projectId ||
      appended.message.taskId !== message.taskId ||
      appended.message.createdAt !== message.createdAt
    ) {
      throw new Error(
        'The idempotent conversation reply belongs to different task output.',
      );
    }
    const projectedAt = clock();
    const projected = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        if (
          candidate.run.conversationReply?.status !== 'pending' ||
          candidate.run.conversationReply.messageId !== message.id
        ) {
          return false;
        }
        candidate.run.conversationReply.status = 'projected';
        candidate.run.conversationReply.projectedAt = projectedAt;
        candidate.run.updatedAt = projectedAt;
        candidate.task.updatedAt = projectedAt;
        appendEvent(
          candidate,
          'conversation_reply_projected',
          projectedAt,
          { conversationId, messageId: message.id },
          createId,
        );
        return true;
      },
    );
    return projected.aggregate;
  }

  async function finalizeConversationReply(
    aggregate: TaskAggregate,
  ): Promise<TaskAggregate> {
    return aggregate.run.conversationReply?.status === 'pending'
      ? projectConversationReply(aggregate)
      : aggregate;
  }

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
      decision.decision.kind === 'goal_planned'
        ? decision.decision.plan.steps.map((step) =>
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
    const selectedAuthority =
      decision.decision.kind === 'approval_required' &&
      selectedCapability !== null
        ? selectedCapability.authorityFor({
            arguments: decision.decision.proposedArguments,
            hasInputArtifacts: false,
          })
        : undefined;
    if (
      selectedCapability !== null &&
      selectedAuthority !== undefined &&
      !authorityIsWithin(selectedAuthority, selectedCapability.authority)
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

        if (selectedCapability === null) {
          throw new Error('The approved capability runtime is unavailable.');
        }
        const requiresProjectContext =
          selectedCapability.authority.projectContext === 'required';
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
          status: 'pending',
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
          destination: selectedCapability.destination,
          authority: selectedAuthority,
          requestedAt: now,
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
      const decision = await options.evaluateModelDecision(
        budgetClaim.aggregate.task.message,
        selectedProject === undefined &&
          budgetClaim.aggregate.run.conversationContext === undefined
          ? undefined
          : {
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
            },
      );
      if (
        decision.decision.kind !== 'approval_required' &&
        decision.decision.kind !== 'goal_planned'
      ) {
        return await recordDecision(budgetClaim.aggregate, decision);
      }
      const plannedSteps =
        decision.decision.kind === 'goal_planned'
          ? decision.decision.plan.steps
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
          objective: firstProjectStep.arguments.objective,
          ticket: firstProjectStep.arguments.ticket,
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
          if (candidate.run.goal !== undefined) {
            candidate.run.goal.status = 'failed';
            setCurrentGoalStepStatus(candidate, 'failed');
          }
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
        candidate.run.invocation = CapabilityInvocationSchema.parse({
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
          ...(candidate.run.approval.authority === undefined
            ? {}
            : { authority: candidate.run.approval.authority }),
          ...(candidate.run.approval.inputArtifacts === undefined
            ? {}
            : { inputArtifacts: candidate.run.approval.inputArtifacts }),
          startedAt: now,
        });
        const goalStep =
          candidate.run.goal?.steps[candidate.run.goal.currentStepIndex];
        if (goalStep !== undefined) {
          if (goalStep.approvalId !== candidate.run.approval.id) {
            throw new Error('The goal step approval identity changed.');
          }
          goalStep.status = 'executing';
          goalStep.invocationId = invocationId;
        }
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
          candidate.run.updatedAt = completedAt;
          candidate.task.updatedAt = completedAt;
          candidate.run.invocation.status = 'succeeded';
          candidate.run.invocation.completedAt = completedAt;
          const { destination: ignoredDestination, ...producerModel } =
            artifact.producer;
          void ignoredDestination;
          candidate.run.invocation.model = producerModel;
          const reference = artifactReference(artifact);
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
          const goal = candidate.run.goal;
          if (goal !== undefined) {
            const step = goal.steps[goal.currentStepIndex];
            if (step?.invocationId !== claimedInvocation.id) {
              throw new Error(
                'The completed invocation is not the active goal step.',
              );
            }
            step.status = 'succeeded';
            step.artifact = reference;
            appendEvent(
              candidate,
              'goal_step_succeeded',
              completedAt,
              {
                goalStepId: step.id,
                artifactId: artifact.id,
                capability: `${step.capability}@${String(step.version)}`,
              },
              createId,
            );
            const nextStepIndex = goal.currentStepIndex + 1;
            if (nextStepIndex < goal.steps.length) {
              archiveCurrentGoalBoundary(candidate);
              prepareGoalStepApproval(candidate, nextStepIndex, completedAt);
              return true;
            }
            const artifacts = goal.steps.map((goalStep) => {
              if (goalStep.artifact === undefined) {
                throw new Error('A completed goal is missing a step artifact.');
              }
              return goalStep.artifact;
            });
            goal.status = 'succeeded';
            candidate.run.status = 'succeeded';
            candidate.task.status = 'completed';
            candidate.run.output = {
              kind: 'goal_result',
              objective: goal.objective,
              summary: goal.summary,
              artifacts,
            };
            appendEvent(
              candidate,
              'goal_succeeded',
              completedAt,
              { artifactIds: artifacts.map((value) => value.id) },
              createId,
            );
            appendEvent(candidate, 'run_succeeded', completedAt, {}, createId);
            return true;
          }

          candidate.run.status = 'succeeded';
          candidate.task.status = 'completed';
          candidate.run.output =
            artifact.type === 'implementation_plan'
              ? {
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
                }
              : artifact.type === 'software_change'
                ? {
                    kind: 'software_change',
                    change: artifact.content,
                    artifact: {
                      id: artifact.id,
                      version: artifact.version,
                      type: artifact.type,
                      mediaType: artifact.mediaType,
                      sha256: artifact.sha256,
                      byteLength: artifact.byteLength,
                    },
                  }
                : artifact.type === 'research_report'
                  ? {
                      kind: 'research_report',
                      report: artifact.content,
                      artifact: {
                        id: artifact.id,
                        version: artifact.version,
                        type: artifact.type,
                        mediaType: artifact.mediaType,
                        sha256: artifact.sha256,
                        byteLength: artifact.byteLength,
                      },
                    }
                  : {
                      kind: 'personal_task_result',
                      result: artifact.content,
                      artifact: {
                        id: artifact.id,
                        version: artifact.version,
                        type: artifact.type,
                        mediaType: artifact.mediaType,
                        sha256: artifact.sha256,
                        byteLength: artifact.byteLength,
                      },
                    };
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
        const existingProjectId =
          'projectId' in existingArtifact
            ? existingArtifact.projectId
            : undefined;
        if (
          existingArtifact.taskId !== claim.aggregate.task.id ||
          existingArtifact.runId !== claim.aggregate.run.id ||
          existingProjectId !== claimedInvocation.project?.id ||
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
        if (!artifactContentIsIntact(existingArtifact)) {
          throw new Error(
            'The idempotent artifact content failed integrity validation.',
          );
        }
        if (
          !sameArtifactReferences(
            existingArtifact.inputs,
            claimedInvocation.inputArtifacts,
          )
        ) {
          throw new Error(
            'The idempotent artifact lineage differs from the approved inputs.',
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
              if (candidate.run.goal !== undefined) {
                candidate.run.goal.status = 'failed';
                setCurrentGoalStepStatus(candidate, 'failed');
              }
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
      const projectReference = claimedInvocation.project;
      const runBudget = executionAggregate.run.budget;
      const approvedDestination = executionAggregate.run.approval?.destination;
      const approvedAuthority = executionAggregate.run.approval?.authority;
      if (runBudget === undefined || approvedDestination === undefined) {
        throw new Error(
          'The approved invocation is missing its destination or limits.',
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
      if (
        claimedInvocation.authority !== undefined &&
        approvedAuthority !== undefined &&
        JSON.stringify(claimedInvocation.authority) !==
          JSON.stringify(approvedAuthority)
      ) {
        throw new Error(
          'The claimed invocation authority differs from the approved authority.',
        );
      }
      const capabilityRuntime = options.capabilities.resolve(
        claimedInvocation.capability,
        approvedDestination,
      );
      if (capabilityRuntime === null) {
        throw new Error(
          `The approved capability adapter ${approvedDestination.adapterId} is unavailable or its destination configuration changed.`,
        );
      }
      const currentAuthority = capabilityRuntime.authorityFor({
        arguments: claimedInvocation.arguments,
        hasInputArtifacts: (claimedInvocation.inputArtifacts?.length ?? 0) > 0,
      });
      if (!authorityIsWithin(currentAuthority, capabilityRuntime.authority)) {
        throw new Error(
          'The capability resolved authority outside its declared maximum.',
        );
      }
      if (
        approvedAuthority !== undefined &&
        !sameAuthority(approvedAuthority, currentAuthority)
      ) {
        throw new Error('The capability authority changed after approval.');
      }
      const requiresProjectContext =
        capabilityRuntime.authority.projectContext === 'required';
      const context = requiresProjectContext
        ? executionAggregate.run.context
        : undefined;
      if (
        requiresProjectContext &&
        (context === undefined || projectReference === undefined)
      ) {
        throw new Error(
          'The approved project capability is missing authoritative context.',
        );
      }
      if (!requiresProjectContext && projectReference !== undefined) {
        throw new Error(
          'A project-independent capability contains unexpected project context.',
        );
      }
      if (context !== undefined && projectReference !== undefined) {
        assertProjectContextIntegrity(context, projectReference.id);
      }
      const activeGoal = executionAggregate.run.goal;
      if (activeGoal !== undefined) {
        const activeStep = activeGoal.steps[activeGoal.currentStepIndex];
        if (activeStep?.invocationId !== claimedInvocation.id) {
          throw new Error('The invocation is not the active goal step.');
        }
        const expectedInputs = activeStep.inputStepIds.map((stepId) => {
          const dependency = activeGoal.steps.find(
            (step) => step.id === stepId,
          );
          if (dependency?.artifact === undefined) {
            throw new Error(
              `The active goal step is missing completed dependency ${stepId}.`,
            );
          }
          return dependency.artifact;
        });
        if (
          !sameArtifactReferences(
            expectedInputs,
            claimedInvocation.inputArtifacts,
          )
        ) {
          throw new Error(
            'The claimed artifact inputs differ from the goal dependencies.',
          );
        }
      } else if (claimedInvocation.inputArtifacts?.length) {
        throw new Error(
          'A non-goal invocation cannot consume prior artifacts.',
        );
      }
      const inputArtifacts: Artifact[] = [];
      for (const reference of claimedInvocation.inputArtifacts ?? []) {
        const inputArtifact = await options.resources.findArtifactById(
          executionAggregate.task.principalId,
          reference.id,
        );
        if (inputArtifact === null) {
          throw new Error(
            `Approved input artifact ${reference.id} was not found.`,
          );
        }
        const inputProjectId =
          'projectId' in inputArtifact ? inputArtifact.projectId : undefined;
        if (
          inputArtifact.taskId !== executionAggregate.task.id ||
          inputArtifact.runId !== executionAggregate.run.id ||
          inputArtifact.type !== reference.type ||
          inputArtifact.mediaType !== reference.mediaType ||
          inputArtifact.sha256 !== reference.sha256 ||
          inputArtifact.byteLength !== reference.byteLength ||
          !artifactContentIsIntact(inputArtifact) ||
          (inputProjectId !== undefined &&
            inputProjectId !== executionAggregate.task.projectId) ||
          !capabilityRuntime.definition.acceptedInputArtifacts.includes(
            inputArtifact.type,
          )
        ) {
          throw new Error(
            `Approved input artifact ${reference.id} failed integrity, scope, or compatibility validation.`,
          );
        }
        inputArtifacts.push(inputArtifact);
      }
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
            if (candidate.run.goal !== undefined) {
              candidate.run.goal.status = 'failed';
              setCurrentGoalStepStatus(candidate, 'failed');
            }
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
      const result = await capabilityRuntime.execute(
        {
          invocationId: claimedInvocation.id,
          principalId: executionAggregate.task.principalId,
          startedAt: claimedInvocation.startedAt,
          recovery: resumingInterruptedInvocation,
          arguments: claimedInvocation.arguments,
          ...(projectReference === undefined
            ? {}
            : { project: projectReference }),
          ...(context === undefined ? {} : { context }),
          ...(inputArtifacts.length === 0 ? {} : { artifacts: inputArtifacts }),
          limits: {
            maxDurationMs: remainingDurationMs,
            maxArtifactBytes: runBudget.limits.maxArtifactBytes,
            maxChangedFiles: runBudget.limits.maxContextFiles,
            maxWebSearchCalls: currentAuthority.maxWebSearchCalls ?? 1,
          },
        },
        { signal: controller.signal },
      );
      const { type: artifactType, mediaType, content } = result.artifact;
      const producerModel = result.model;
      const contentJson = JSON.stringify(content);
      let artifact = ArtifactSchema.parse({
        schemaVersion: 1,
        id: `artifact_${claimedInvocation.id.slice('invocation_'.length)}`,
        version: 1,
        principalId: claim.aggregate.task.principalId,
        taskId: claim.aggregate.task.id,
        runId: claim.aggregate.run.id,
        invocationId: claimedInvocation.id,
        ...(projectReference === undefined
          ? {}
          : { projectId: projectReference.id }),
        type: artifactType,
        mediaType,
        sha256: createHash('sha256').update(contentJson).digest('hex'),
        byteLength: Buffer.byteLength(contentJson),
        producer: {
          destination: approvedDestination,
          ...producerModel,
        },
        ...(claimedInvocation.inputArtifacts === undefined
          ? {}
          : { inputs: claimedInvocation.inputArtifacts }),
        content,
        createdAt: clock(),
      });
      const normalizedContentJson = JSON.stringify(artifact.content);
      artifact = ArtifactSchema.parse({
        ...artifact,
        sha256: createHash('sha256')
          .update(normalizedContentJson)
          .digest('hex'),
        byteLength: Buffer.byteLength(normalizedContentJson),
      });
      if (artifact.byteLength > runBudget.limits.maxArtifactBytes) {
        throw new Error(
          'The capability artifact exceeded the artifact byte limit.',
        );
      }
      const storedArtifact = await options.resources.createArtifact(artifact);
      const storedProjectId =
        'projectId' in storedArtifact.artifact
          ? storedArtifact.artifact.projectId
          : undefined;
      if (
        storedArtifact.artifact.taskId !== claim.aggregate.task.id ||
        storedArtifact.artifact.runId !== claim.aggregate.run.id ||
        storedArtifact.artifact.invocationId !== claimedInvocation.id ||
        storedProjectId !== projectReference?.id ||
        storedArtifact.artifact.type !== artifactType ||
        storedArtifact.artifact.mediaType !== mediaType ||
        storedArtifact.artifact.producer.destination === undefined ||
        !sameCapabilityDestination(
          storedArtifact.artifact.producer.destination,
          approvedDestination,
        )
      ) {
        throw new Error(
          'The stored artifact belongs to a different invocation context.',
        );
      }
      if (!artifactContentIsIntact(storedArtifact.artifact)) {
        throw new Error(
          'The stored artifact content failed integrity validation.',
        );
      }
      if (
        !sameArtifactReferences(
          storedArtifact.artifact.inputs,
          claimedInvocation.inputArtifacts,
        )
      ) {
        throw new Error(
          'The stored artifact lineage differs from the approved inputs.',
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
            if (candidate.run.goal !== undefined) {
              candidate.run.goal.status = 'cancelled';
              setCurrentGoalStepStatus(candidate, 'cancelled');
            }
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
        `The ${claimedInvocation.capability.name.replaceAll('_', ' ')} capability could not complete the task.`,
        'capability_invocation_failed',
      );
    } finally {
      activeInvocations.delete(claimedInvocation.id);
    }
  }

  async function finalizeInterruptedCancellation(
    aggregate: TaskAggregate,
  ): Promise<TaskAggregate> {
    const cancelledAt = clock();
    const cancellation = await update(
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
        if (candidate.run.goal !== undefined) {
          candidate.run.goal.status = 'cancelled';
          setCurrentGoalStepStatus(candidate, 'cancelled');
        }
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
    return cancellation.aggregate;
  }

  async function progress(aggregate: TaskAggregate): Promise<TaskAggregate> {
    await project(aggregate);
    if (requiresConversationReplyProjection(aggregate)) {
      const recoveredAt = clock();
      const recovered = await update(
        aggregate.task.principalId,
        aggregate.task.id,
        (candidate) => {
          if (!requiresConversationReplyProjection(candidate)) return false;
          addConversationReplyProjection(candidate, recoveredAt);
          return true;
        },
      );
      return finalizeConversationReply(recovered.aggregate);
    }
    if (aggregate.run.conversationReply?.status === 'pending') {
      return projectConversationReply(aggregate);
    }
    if (aggregate.run.status === 'deciding') {
      return finalizeConversationReply(await evaluate(aggregate));
    }
    if (aggregate.run.status === 'cancellation_requested') {
      return finalizeConversationReply(
        await finalizeInterruptedCancellation(aggregate),
      );
    }
    if (
      aggregate.run.status === 'awaiting_approval' &&
      aggregate.run.approval?.status === 'approved'
    ) {
      return finalizeConversationReply(await executeApproved(aggregate, false));
    }
    if (aggregate.run.status === 'executing') {
      return finalizeConversationReply(await executeApproved(aggregate, true));
    }
    return aggregate;
  }

  return {
    async submit(input) {
      const existing = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        assertMatchingTaskInput(existing, input);
        await project(existing);
        return finalizeConversationReply(existing);
      }
      const now = clock();
      const taskId = createId('task');
      const runId = createId('run');
      const conversationContext = await prepareConversationContext(input);
      const initialEvents: TaskAggregate['events'] = [
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
      ];
      if (conversationContext !== undefined) {
        initialEvents.push({
          schemaVersion: 1,
          id: createId('event'),
          sequence: initialEvents.length + 1,
          type: 'conversation_context_assembled',
          occurredAt: now,
          data: {
            conversationId: conversationContext.manifest.conversationId,
            totalMessages: conversationContext.manifest.totalMessages,
            totalCharacters: conversationContext.manifest.totalCharacters,
            exclusions: conversationContext.manifest.exclusions,
          },
        });
      }
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
          ...(conversationContext === undefined ? {} : { conversationContext }),
        },
        events: initialEvents,
      };
      const creation = await options.store.create(
        TaskAggregateSchema.parse(aggregate),
      );
      await project(creation.aggregate);
      if (!creation.created) {
        assertMatchingTaskInput(creation.aggregate, input);
        if (
          JSON.stringify(creation.aggregate.run.conversationContext) !==
          JSON.stringify(conversationContext)
        ) {
          throw new LifecycleError(
            `Idempotency key ${input.requestKey} is already associated with different conversation context.`,
            'idempotency_key_reused',
          );
        }
      }
      if (!creation.created || executionMode === 'worker') {
        return creation.aggregate;
      }
      return finalizeConversationReply(await evaluate(creation.aggregate));
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
      const historicalApproval = existing.run.approvalHistory?.find(
        (approval) => approval.id === input.approvalId,
      );
      if (historicalApproval !== undefined) {
        if (historicalApproval.status !== input.decision) {
          throw new LifecycleError(
            `Approval ${input.approvalId} has already been ${historicalApproval.status}.`,
            'approval_already_decided',
          );
        }
        return finalizeConversationReply(existing);
      }
      if (currentStatus !== 'pending') {
        if (currentStatus !== input.decision) {
          throw new LifecycleError(
            `Approval ${input.approvalId} has already been ${String(currentStatus)}.`,
            'approval_already_decided',
          );
        }
        const progressed =
          currentStatus === 'approved' && executionMode === 'inline'
            ? await executeApproved(existing, false)
            : existing;
        return finalizeConversationReply(progressed);
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
            if (aggregate.run.goal !== undefined) {
              aggregate.run.goal.status = 'rejected';
              setCurrentGoalStepStatus(aggregate, 'rejected');
            }
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
      const progressed =
        input.decision === 'approved' && executionMode === 'inline'
          ? await executeApproved(decision.aggregate, false)
          : decision.aggregate;
      return finalizeConversationReply(progressed);
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
        return finalizeConversationReply(existing);
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
          if (!wasExecuting && aggregate.run.goal !== undefined) {
            aggregate.run.goal.status = 'cancelled';
            setCurrentGoalStepStatus(aggregate, 'cancelled');
          }
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
      return finalizeConversationReply(cancellation.aggregate);
    },

    async progressTask(principalId, taskId) {
      const aggregate = await options.store.findByTaskId(principalId, taskId);
      if (aggregate === null) {
        throw new LifecycleError(
          `Task ${taskId} was not found.`,
          'task_not_found',
        );
      }
      return progress(aggregate);
    },

    async recoverInterrupted() {
      const aggregates = await options.store.findRecoverable();
      for (const aggregate of aggregates) {
        await progress(aggregate);
      }
    },
  };
}
