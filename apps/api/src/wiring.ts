import { createEvaluateModelDecision } from './application/evaluate-model-decision.ts';
import {
  createTaskLifecycle,
  type TaskLifecycle,
} from './application/task-lifecycle.ts';
import { InMemoryExecutionStore } from './adapters/in-memory-execution-store.ts';
import { InMemoryResourceStore } from './adapters/in-memory-resource-store.ts';
import { InMemoryScratchpad } from './adapters/in-memory-scratchpad.ts';
import { InMemoryWorkLeaseStore } from './adapters/in-memory-work-lease-store.ts';
import {
  LocalGitProjectContextAssembler,
  resolveLocalGitRoot,
} from './adapters/local-git-project-context-assembler.ts';
import { MongoDbExecutionStore } from './adapters/mongodb-execution-store.ts';
import { MongoDbResourceStore } from './adapters/mongodb-resource-store.ts';
import { MongoDbWorkLeaseStore } from './adapters/mongodb-work-lease-store.ts';
import { RedisScratchpad } from './adapters/redis-scratchpad.ts';
import { createDevelopmentPlanningCapabilityRegistry } from './capabilities/development-planning-adapter-registry.ts';
import { createResourceService } from './application/resource-service.ts';
import { createTaskWorker } from './application/task-worker.ts';
import type { AppConfig } from './config.ts';
import { DefaultRunBudget } from './domain/run-budget.ts';
import { buildApp } from './http/build-app.ts';
import { createModelProvider } from './model/model-provider-registry.ts';
import type { ExecutionStore } from './ports/execution-store.ts';
import type { Scratchpad } from './ports/scratchpad.ts';
import type { ResourceStore } from './ports/resource-store.ts';
import type { WorkLeaseStore } from './ports/work-lease-store.ts';

export function createApp(config: AppConfig) {
  if (config.worker.leaseMs <= DefaultRunBudget.limits.maxDurationMs) {
    throw new Error(
      'WORKER_LEASE_MS must exceed the maximum configured run duration.',
    );
  }
  const provider = createModelProvider(config.model);
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
  const resources: ResourceStore =
    config.storage.mode === 'memory'
      ? new InMemoryResourceStore()
      : new MongoDbResourceStore({
          uri: config.storage.mongodbUri,
          database: config.storage.mongodbDatabase,
          timeoutMs: config.storage.dependencyTimeoutMs,
        });
  const leases: WorkLeaseStore =
    config.storage.mode === 'memory'
      ? new InMemoryWorkLeaseStore()
      : new MongoDbWorkLeaseStore({
          uri: config.storage.mongodbUri,
          database: config.storage.mongodbDatabase,
          timeoutMs: config.storage.dependencyTimeoutMs,
        });
  const resourceService = createResourceService({
    store: resources,
    resolveLocalGitRoot,
  });
  const contextAssembler = new LocalGitProjectContextAssembler();
  const developmentPlanning = createDevelopmentPlanningCapabilityRegistry({
    config: { planning: config.planning, storage: config.storage },
    provider,
  });

  const appReference: { current?: ReturnType<typeof buildApp> } = {};
  const lifecycleObserver = {
    warning(error: unknown, context: Record<string, unknown>) {
      appReference.current?.log.warn(
        { err: error, ...context },
        'Task lifecycle warning',
      );
    },
  };
  const lifecycle = createTaskLifecycle({
    store,
    scratchpad,
    evaluateModelDecision,
    developmentPlanning,
    resources,
    contextAssembler,
    executionMode: 'worker',
    observer: lifecycleObserver,
  });
  const worker = createTaskWorker({
    store,
    leases,
    lifecycle,
    concurrency: config.worker.concurrency,
    pollIntervalMs: config.worker.pollIntervalMs,
    leaseMs: config.worker.leaseMs,
    observer: lifecycleObserver,
    beforeWork: async () => {
      await Promise.all([store.checkReadiness(), resources.checkReadiness()]);
    },
  });
  const dispatchedLifecycle: TaskLifecycle = {
    async submit(input) {
      const aggregate = await lifecycle.submit(input);
      worker.wake();
      return aggregate;
    },
    getTask: (principalId, taskId) => lifecycle.getTask(principalId, taskId),
    getRun: (principalId, runId) => lifecycle.getRun(principalId, runId),
    async decideApproval(input) {
      const aggregate = await lifecycle.decideApproval(input);
      worker.wake();
      return aggregate;
    },
    async cancelRun(input) {
      const aggregate = await lifecycle.cancelRun(input);
      worker.wake();
      return aggregate;
    },
    progressTask: (principalId, taskId) =>
      lifecycle.progressTask(principalId, taskId),
    recoverInterrupted: () => lifecycle.recoverInterrupted(),
  };

  const app = buildApp({
    evaluateModelDecision,
    provider,
    taskLifecycle: dispatchedLifecycle,
    resources: resourceService,
    readinessChecks: [
      {
        name: 'mongodb_operational_store',
        check: () => store.checkReadiness(),
      },
      { name: 'redis_scratchpad', check: () => scratchpad.checkReadiness() },
      {
        name: 'mongodb_resource_store',
        check: () => resources.checkReadiness(),
      },
      {
        name: 'development_planning_capability',
        check: () => developmentPlanning.selected().checkReadiness(),
      },
      { name: 'task_worker', check: () => worker.checkReadiness() },
    ],
    close: async () => {
      await worker.stop();
      await Promise.all([
        store.close(),
        scratchpad.close(),
        resources.close(),
        leases.close(),
      ]);
    },
    logger: true,
  });
  appReference.current = app;
  worker.start();
  return app;
}
