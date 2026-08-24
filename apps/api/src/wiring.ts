import { createEvaluateModelDecision } from './application/evaluate-model-decision.ts';
import {
  createTaskLifecycle,
  type TaskLifecycle,
} from './application/task-lifecycle.ts';
import { InMemoryExecutionStore } from './adapters/in-memory-execution-store.ts';
import { InMemoryScratchpad } from './adapters/in-memory-scratchpad.ts';
import { MongoDbExecutionStore } from './adapters/mongodb-execution-store.ts';
import { RedisScratchpad } from './adapters/redis-scratchpad.ts';
import { ModelDevelopmentPlanningCapability } from './capabilities/model-development-planning-capability.ts';
import type { AppConfig } from './config.ts';
import { buildApp } from './http/build-app.ts';
import { DeterministicModelProvider } from './model/deterministic-model-provider.ts';
import type { ModelProvider } from './model/model-provider.ts';
import { OllamaModelProvider } from './model/ollama-model-provider.ts';
import type { ExecutionStore } from './ports/execution-store.ts';
import type { Scratchpad } from './ports/scratchpad.ts';

function createModelProvider(config: AppConfig): ModelProvider {
  if (config.modelProvider === 'deterministic') {
    return new DeterministicModelProvider();
  }

  return new OllamaModelProvider(config.ollama);
}

export function createApp(config: AppConfig) {
  const provider = createModelProvider(config);
  const evaluateModelDecision = createEvaluateModelDecision(provider);
  const store: ExecutionStore =
    config.storage.mode === 'memory'
      ? new InMemoryExecutionStore()
      : new MongoDbExecutionStore({
          uri: config.storage.mongodbUri,
          database: config.storage.mongodbDatabase,
          timeoutMs: config.storage.dependencyTimeoutMs,
        });
  const scratchpad: Scratchpad =
    config.storage.mode === 'memory'
      ? new InMemoryScratchpad()
      : new RedisScratchpad({
          url: config.storage.redisUrl,
          ttlSeconds: config.storage.scratchpadTtlSeconds,
          timeoutMs: config.storage.dependencyTimeoutMs,
        });

  const appReference: { current?: ReturnType<typeof buildApp> } = {};
  const lifecycle = createTaskLifecycle({
    store,
    scratchpad,
    evaluateModelDecision,
    developmentPlanning: new ModelDevelopmentPlanningCapability(provider),
    observer: {
      warning(error, context) {
        appReference.current?.log.warn(
          { err: error, ...context },
          'Task lifecycle warning',
        );
      },
    },
  });

  let recovery: Promise<void> | undefined;
  const ensureRecovered = (): Promise<void> => {
    recovery ??= lifecycle.recoverInterrupted().catch((error: unknown) => {
      recovery = undefined;
      throw error;
    });
    return recovery;
  };
  const guardedLifecycle: TaskLifecycle = {
    async submit(input) {
      await ensureRecovered();
      return lifecycle.submit(input);
    },
    getTask: (taskId) => lifecycle.getTask(taskId),
    getRun: (runId) => lifecycle.getRun(runId),
    async decideApproval(input) {
      await ensureRecovered();
      return lifecycle.decideApproval(input);
    },
    recoverInterrupted: ensureRecovered,
  };

  const app = buildApp({
    evaluateModelDecision,
    provider,
    taskLifecycle: guardedLifecycle,
    readinessChecks: [
      {
        name: 'mongodb_operational_store',
        check: () => store.checkReadiness(),
      },
      { name: 'redis_scratchpad', check: () => scratchpad.checkReadiness() },
      { name: 'lifecycle_recovery', check: ensureRecovered },
    ],
    close: async () => {
      await Promise.all([store.close(), scratchpad.close()]);
    },
    logger: true,
  });
  appReference.current = app;
  return app;
}
