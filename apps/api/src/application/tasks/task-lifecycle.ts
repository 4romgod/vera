import { randomUUID } from 'node:crypto';

import { DefaultRunBudget } from '../../domain/tasks/run-budget.ts';
import { createAdaptiveGoalOperations } from './lifecycle/adaptive-goal.ts';
import {
  type LifecycleObserver,
  type TaskLifecycleOptions,
  type TaskLifecycleRuntime,
} from './lifecycle/contracts.ts';
import { createDecisionRecording } from './lifecycle/decision-recording.ts';
import { createEvaluationOperations } from './lifecycle/evaluation.ts';
import { createExecutionOperations } from './lifecycle/execution.ts';
import { createTaskLifecycleFoundation } from './lifecycle/foundation.ts';
import { createProgressOperations } from './lifecycle/progress.ts';
import { createTaskLifecycleApi } from './lifecycle/public-api.ts';

export {
  LifecycleError,
  type LifecycleErrorCode,
  type LifecycleObserver,
  type TaskLifecycle,
} from './lifecycle/contracts.ts';

const defaultObserver: LifecycleObserver = {
  warning: () => undefined,
};

function createRuntime(options: TaskLifecycleOptions): TaskLifecycleRuntime {
  return {
    options,
    observer: options.observer ?? defaultObserver,
    clock: options.clock ?? (() => new Date().toISOString()),
    createId:
      options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`),
    budget: options.budget ?? DefaultRunBudget,
    executionMode: options.executionMode ?? 'inline',
    conversationContextLimits: options.conversationContextLimits ?? {
      maxMessages: 20,
      maxCharacters: 40_000,
    },
    ownerTimeZone: options.ownerTimeZone ?? 'UTC',
    memoryContextEnabled: options.memoryContext?.enabled ?? false,
    memoryContextLimits: options.memoryContext?.limits ?? {
      maxMemories: 20,
      maxCharacters: 12_000,
    },
    activeInvocations: new Map<string, AbortController>(),
  };
}

export function createTaskLifecycle(options: TaskLifecycleOptions) {
  const runtime = createRuntime(options);
  const foundation = createTaskLifecycleFoundation(runtime);
  const decisionRecording = createDecisionRecording(runtime, foundation);
  const adaptiveGoal = createAdaptiveGoalOperations(runtime, {
    ...foundation,
    ...decisionRecording,
  });
  const evaluation = createEvaluationOperations(runtime, {
    ...foundation,
    ...decisionRecording,
    ...adaptiveGoal,
  });
  const execution = createExecutionOperations(runtime, {
    ...foundation,
    ...decisionRecording,
  });
  const progress = createProgressOperations(runtime, {
    ...foundation,
    ...evaluation,
    ...execution,
  });

  return createTaskLifecycleApi(runtime, {
    ...foundation,
    ...decisionRecording,
    ...adaptiveGoal,
    ...evaluation,
    ...execution,
    ...progress,
  });
}
