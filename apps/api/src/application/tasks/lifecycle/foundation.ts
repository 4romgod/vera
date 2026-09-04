import { createHash } from 'node:crypto';
import { assembleConversationContext } from '../../conversations/assemble-conversation-context.ts';
import {
  ArtifactReferenceSchema,
  type Artifact,
} from '../../../domain/artifacts/artifact.ts';
import type { CapabilityAuthority } from '../../../domain/capabilities/capability-registry.ts';
import type { ConversationContextBundle } from '../../../domain/conversations/conversation-context.ts';
import { ConversationMessageSchema } from '../../../domain/conversations/conversation.ts';
import {
  ApprovalSchema,
  TaskAggregateSchema,
  type TaskAggregate,
} from '../../../domain/tasks/task-aggregate.ts';
import type { CapabilityRuntimeRegistry } from '../../../ports/capabilities/capability-runtime.ts';
import { projectTaskScratchpad } from '../project-task-scratchpad.ts';
import { assembleMemoryContext } from '../../memories/assemble-memory-context.ts';
import type { AttachmentReference } from '../../../domain/attachments/attachment.ts';
import {
  appendEvent,
  LifecycleError,
  type TaskLifecycle,
  type TaskLifecycleRuntime,
} from './contracts.ts';

export function createTaskLifecycleFoundation(runtime: TaskLifecycleRuntime) {
  const {
    options,
    observer,
    clock,
    createId,
    conversationContextLimits,
    memoryContextEnabled,
    memoryContextLimits,
  } = runtime;
  function destinationFor(
    runtime: NonNullable<ReturnType<CapabilityRuntimeRegistry['selected']>>,
    arguments_: Record<string, unknown>,
  ) {
    return runtime.destinationFor?.(arguments_) ?? runtime.destination;
  }

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

  function sameAttachmentReferences(
    left: AttachmentReference[] | undefined,
    right: AttachmentReference[] | undefined,
  ): boolean {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }

  function authorityIsWithin(
    effective: CapabilityAuthority,
    maximum: CapabilityAuthority,
  ): boolean {
    return (
      (effective.approval === maximum.approval ||
        (effective.approval === 'never' && maximum.approval === 'always')) &&
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
      left.approval === right.approval &&
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

  function sameAuthorityOrLegacyDecisionEvidence(
    approved: CapabilityAuthority,
    current: CapabilityAuthority,
    invocation: {
      inputArtifacts?: Artifact['inputs'];
      decisionEvidence?: Artifact['inputs'];
    },
  ): boolean {
    if (sameAuthority(approved, current)) return true;
    const isLegacyDecisionEvidenceApproval =
      (invocation.decisionEvidence?.length ?? 0) > 0 &&
      (invocation.inputArtifacts?.length ?? 0) === 0 &&
      !approved.dataClasses.includes('artifact_content') &&
      current.dataClasses.includes('artifact_content');
    if (!isLegacyDecisionEvidenceApproval) return false;
    return sameAuthority(approved, {
      ...current,
      dataClasses: current.dataClasses.filter(
        (dataClass) => dataClass !== 'artifact_content',
      ),
    });
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
    decisionEvidence: ReturnType<typeof artifactReference>[] = [],
  ): void {
    const goal = aggregate.run.goal;
    const step = goal?.steps[stepIndex];
    if (goal === undefined || step === undefined) {
      throw new Error('The goal does not contain the requested step.');
    }
    const reference = {
      name: step.capability,
      version: step.version,
    };
    const selectedRuntime = options.capabilities.selected(reference);
    if (selectedRuntime === null) {
      throw new Error(
        `Goal capability ${step.capability}@${String(step.version)} is unavailable.`,
      );
    }
    const destination = destinationFor(selectedRuntime, step.arguments);
    const runtime = options.capabilities.resolve(reference, destination);
    if (runtime === null) {
      throw new Error(
        `Goal capability ${step.capability}@${String(step.version)} could not resolve its selected destination.`,
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
      hasDecisionEvidence: decisionEvidence.length > 0,
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
      ...(decisionEvidence.length === 0 ? {} : { decisionEvidence }),
      ...(step.capability === 'attachment_analysis'
        ? { attachments: aggregate.task.attachments }
        : {}),
      destination,
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
        decisionEvidenceArtifactIds: decisionEvidence.map(
          (artifact) => artifact.id,
        ),
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
    if (aggregate.run.output?.kind === 'personal_reminder_result') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        aggregate.run.output.result.summary,
        ...aggregate.run.output.result.reminders.map(
          (reminder) =>
            `[${reminder.status}] ${reminder.message} at ${reminder.scheduledFor} (${reminder.id})`,
        ),
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'memory_result') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        aggregate.run.output.result.summary,
        ...aggregate.run.output.result.memories.map(
          (memory) =>
            `[${memory.status}] ${memory.subject}: ${memory.content} (${memory.id}, revision ${String(memory.revision)})`,
        ),
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'attachment_analysis') {
      const artifactId = aggregate.run.output.artifact?.id;
      return [
        `I analyzed ${String(aggregate.run.output.analysis.attachments.length)} attachment(s).`,
        aggregate.run.output.analysis.summary,
        ...aggregate.run.output.analysis.findings.map(
          (finding) => `- ${finding}`,
        ),
        ...(artifactId === undefined ? [] : [`Artifact: ${artifactId}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'machine_diagnostic') {
      const diagnostic = aggregate.run.output.diagnostic;
      return [
        `I inspected ${diagnostic.machine.displayName}.`,
        ...diagnostic.services.map(
          (service) =>
            `${service.displayName}: ${service.observation.status} — ${service.observation.summary}`,
        ),
        ...(aggregate.run.output.artifact === undefined
          ? []
          : [`Artifact: ${aggregate.run.output.artifact.id}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'machine_service_action_result') {
      const result = aggregate.run.output.result;
      return [
        `${result.action} ${result.service.displayName} on ${result.machine.displayName}: ${result.verified ? 'verified' : 'not verified'}.`,
        `Before: ${result.before.status}. After: ${result.after.status}.`,
        ...(aggregate.run.output.artifact === undefined
          ? []
          : [`Artifact: ${aggregate.run.output.artifact.id}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'mission_management_result') {
      const result = aggregate.run.output.result;
      return [
        result.summary,
        `Mission: ${result.mission.id}`,
        ...(aggregate.run.output.artifact === undefined
          ? []
          : [`Artifact: ${aggregate.run.output.artifact.id}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'knowledge_result') {
      const result = aggregate.run.output.result;
      return [
        result.answer ?? result.summary,
        ...(result.citations ?? []).map(
          (citation, index) =>
            `[${String(index + 1)}] ${citation.sourceTitle} — ${citation.locator}: ${citation.excerpt}`,
        ),
        ...(result.limitations ?? []).map(
          (limitation) => `Limitation: ${limitation}`,
        ),
        ...(aggregate.run.output.artifact === undefined
          ? []
          : [`Artifact: ${aggregate.run.output.artifact.id}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'attention_result') {
      const { briefing } = aggregate.run.output.result;
      return [
        briefing.headline,
        briefing.summary,
        ...briefing.items
          .slice(0, 10)
          .map(
            (item, index) =>
              `${String(index + 1)}. [${item.priority}] ${item.title} — ${item.summary}`,
          ),
        ...(aggregate.run.output.artifact === undefined
          ? []
          : [`Artifact: ${aggregate.run.output.artifact.id}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'routine_management_result') {
      const result = aggregate.run.output.result;
      return [
        result.summary,
        ...(result.routines ?? []).map(
          (routine) =>
            `${routine.approval.effect.title} — ${routine.status} — ${routine.id} — ${routine.approval.effect.schedule.localTime} ${routine.approval.effect.schedule.timeZone}`,
        ),
        ...(result.routine === undefined
          ? []
          : [`Routine: ${result.routine.id}`]),
        ...(result.run === undefined ? [] : [`Run: ${result.run.id}`]),
        ...(aggregate.run.output.artifact === undefined
          ? []
          : [`Artifact: ${aggregate.run.output.artifact.id}`]),
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'goal_result') {
      return [
        `I completed the goal through ${String(aggregate.run.output.artifacts.length)} approved capability steps.`,
        aggregate.run.output.summary,
        `Artifacts: ${aggregate.run.output.artifacts.map((artifact) => artifact.id).join(', ')}`,
      ].join('\n\n');
    }
    if (aggregate.run.output?.kind === 'adaptive_goal_result') {
      return aggregate.run.output.message;
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
    attachments?: AttachmentReference[];
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
      currentMessage.projectId !== input.projectId ||
      JSON.stringify(currentMessage.attachments ?? []) !==
        JSON.stringify(input.attachments ?? [])
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

  async function prepareMemoryContext(input: {
    principalId: string;
    projectId?: string;
    assembledAt: string;
  }) {
    if (!memoryContextEnabled) return undefined;
    return assembleMemoryContext({
      store: options.resources,
      principalId: input.principalId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      assembledAt: input.assembledAt,
      limits: memoryContextLimits,
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
      aggregate.task.projectRevision !== input.projectRevision ||
      aggregate.task.conversationId !== input.conversationId ||
      aggregate.task.messageId !== input.messageId ||
      JSON.stringify(aggregate.task.attachments ?? []) !==
        JSON.stringify(input.attachments ?? [])
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

  return {
    destinationFor,
    artifactReference,
    artifactContentIsIntact,
    sameArtifactReferences,
    sameAttachmentReferences,
    authorityIsWithin,
    sameAuthority,
    sameAuthorityOrLegacyDecisionEvidence,
    setCurrentGoalStepStatus,
    archiveCurrentGoalBoundary,
    prepareGoalStepApproval,
    conversationReplyContent,
    requiresConversationReplyProjection,
    addConversationReplyProjection,
    ensureConversationReplyProjection,
    project,
    update,
    prepareConversationContext,
    prepareMemoryContext,
    assertMatchingTaskInput,
    projectConversationReply,
    finalizeConversationReply,
  };
}

export type TaskLifecycleFoundation = ReturnType<
  typeof createTaskLifecycleFoundation
>;
