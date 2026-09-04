import type { EvaluateModelDecision } from '../../model-decisions/evaluate-model-decision.ts';
import type { EvaluateGoalContinuation } from '../../model-decisions/evaluate-goal-continuation.ts';
import type { AttachmentReference } from '../../../domain/attachments/attachment.ts';
import type { ConversationContextLimits } from '../../../domain/conversations/conversation-context.ts';
import type { MemoryContextLimits } from '../../../domain/memories/memory-context.ts';
import type { RunBudget } from '../../../domain/tasks/run-budget.ts';
import type {
  TaskAggregate,
  TaskEventType,
} from '../../../domain/tasks/task-aggregate.ts';
import type { CapabilityRuntimeRegistry } from '../../../ports/capabilities/capability-runtime.ts';
import type { ExecutionStore } from '../../../ports/persistence/execution-store.ts';
import type { OwnerResourceStore } from '../../../ports/persistence/owner-resource-store.ts';
import type { Scratchpad } from '../../../ports/persistence/scratchpad.ts';
import type { ProjectContextAssembler } from '../../../ports/projects/project-context-assembler.ts';
import type { SoftwareDeliveryContext } from '../../../domain/software-delivery/software-delivery-management.ts';

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
    projectRevision?: string;
    conversationId?: string;
    messageId?: string;
    attachments?: AttachmentReference[];
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

export type IdFactory = (prefix: string) => string;
export type Clock = () => string;

export type TaskLifecycleOptions = {
  store: ExecutionStore;
  scratchpad: Scratchpad;
  evaluateModelDecision: EvaluateModelDecision;
  evaluateGoalContinuation?: EvaluateGoalContinuation;
  capabilities: CapabilityRuntimeRegistry;
  resources: OwnerResourceStore;
  contextAssembler: ProjectContextAssembler;
  conversationContextLimits?: ConversationContextLimits;
  memoryContext?: {
    enabled: boolean;
    limits?: MemoryContextLimits;
  };
  softwareDeliveryContext?: {
    assemble(principalId: string): Promise<SoftwareDeliveryContext>;
  };
  ownerTimeZone?: string;
  budget?: RunBudget;
  executionMode?: 'inline' | 'worker';
  observer?: LifecycleObserver;
  clock?: Clock;
  createId?: IdFactory;
};

export type TaskLifecycleRuntime = {
  options: TaskLifecycleOptions;
  observer: LifecycleObserver;
  clock: Clock;
  createId: IdFactory;
  budget: RunBudget;
  executionMode: 'inline' | 'worker';
  conversationContextLimits: ConversationContextLimits;
  ownerTimeZone: string;
  memoryContextEnabled: boolean;
  memoryContextLimits: MemoryContextLimits;
  activeInvocations: Map<string, AbortController>;
};

export function appendEvent(
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
