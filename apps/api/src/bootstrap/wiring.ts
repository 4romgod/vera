import { createEvaluateModelDecision } from '../application/model-decisions/evaluate-model-decision.ts';
import { createEvaluateGoalContinuation } from '../application/model-decisions/evaluate-goal-continuation.ts';
import {
  createTaskLifecycle,
  type TaskLifecycle,
} from '../application/tasks/task-lifecycle.ts';
import { InMemoryExecutionStore } from '../adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import { InMemoryOwnerResourceStore } from '../adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { InMemoryScratchpad } from '../adapters/outbound/persistence/memory/in-memory-scratchpad.ts';
import { InMemoryWorkLeaseStore } from '../adapters/outbound/persistence/memory/in-memory-work-lease-store.ts';
import { InMemoryChangeApplicationStore } from '../adapters/outbound/persistence/memory/in-memory-change-application-store.ts';
import { MongoDbChangeApplicationStore } from '../adapters/outbound/persistence/mongodb/mongodb-change-application-store.ts';
import { InMemoryProjectMutationLeaseStore } from '../adapters/outbound/persistence/memory/in-memory-project-mutation-lease-store.ts';
import { MongoDbProjectMutationLeaseStore } from '../adapters/outbound/persistence/mongodb/mongodb-project-mutation-lease-store.ts';
import { LocalGitSoftwareChangeApplicationExecutor } from '../adapters/outbound/change-applications/local-git-software-change-application-executor.ts';
import {
  LocalGitProjectContextAssembler,
  resolveLocalGitRoot,
} from '../adapters/outbound/project-context/local-git-project-context-assembler.ts';
import { MongoDbExecutionStore } from '../adapters/outbound/persistence/mongodb/mongodb-execution-store.ts';
import { MongoDbOwnerResourceStore } from '../adapters/outbound/persistence/mongodb/mongodb-owner-resource-store.ts';
import { MongoDbWorkLeaseStore } from '../adapters/outbound/persistence/mongodb/mongodb-work-lease-store.ts';
import { RedisScratchpad } from '../adapters/outbound/persistence/redis/redis-scratchpad.ts';
import { createDevelopmentPlanningCapabilityRegistry } from '../adapters/outbound/capabilities/development-planning/development-planning-adapter-registry.ts';
import { createSoftwareChangeCapabilityRegistry } from '../adapters/outbound/capabilities/software-change/software-change-adapter-registry.ts';
import { createWebResearchCapabilityRegistry } from '../adapters/outbound/capabilities/web-research/web-research-adapter-registry.ts';
import { createCapabilityRuntimeRegistry } from '../adapters/outbound/capabilities/capability-runtime-registry.ts';
import { createArtifactService } from '../application/artifacts/artifact-service.ts';
import { createConversationService } from '../application/conversations/conversation-service.ts';
import { createProjectService } from '../application/projects/project-service.ts';
import { createTaskWorker } from '../application/tasks/task-worker.ts';
import { createSoftwareChangeApplicationLifecycle } from '../application/change-applications/software-change-application-lifecycle.ts';
import { createSoftwareChangeApplicationWorker } from '../application/change-applications/software-change-application-worker.ts';
import { createCapabilityService } from '../application/capabilities/capability-service.ts';
import type { AppConfig } from './config.ts';
import { DefaultRunBudget } from '../domain/tasks/run-budget.ts';
import { buildApp } from '../adapters/inbound/http/build-app.ts';
import { createModelProvider } from '../adapters/outbound/model/model-provider-registry.ts';
import type { ExecutionStore } from '../ports/persistence/execution-store.ts';
import type { Scratchpad } from '../ports/persistence/scratchpad.ts';
import type { OwnerResourceStore } from '../ports/persistence/owner-resource-store.ts';
import type { WorkLeaseStore } from '../ports/persistence/work-lease-store.ts';
import type { ChangeApplicationStore } from '../ports/persistence/change-application-store.ts';
import type { ProjectMutationLeaseStore } from '../ports/persistence/project-mutation-lease-store.ts';
import { LocalPersonalTaskActionExecutor } from '../adapters/outbound/integrations/personal-tasks/local-personal-task-action-executor.ts';
import { createPersonalTaskService } from '../application/personal-tasks/personal-task-service.ts';
import { LocalReminderActionExecutor } from '../adapters/outbound/integrations/reminders/local-reminder-action-executor.ts';
import { VeraInboxReminderDelivery } from '../adapters/outbound/notifications/vera-inbox-reminder-delivery.ts';
import { createReminderService } from '../application/reminders/reminder-service.ts';
import { createNotificationService } from '../application/reminders/notification-service.ts';
import { createReminderWorker } from '../application/reminders/reminder-worker.ts';
import { LocalMemoryActionExecutor } from '../adapters/outbound/integrations/memories/local-memory-action-executor.ts';
import { createMemoryService } from '../application/memories/memory-service.ts';

export function createApp(
  config: AppConfig,
  runtime: { logger?: Parameters<typeof buildApp>[0]['logger'] } = {},
) {
  if (config.worker.leaseMs <= DefaultRunBudget.limits.maxDurationMs) {
    throw new Error(
      'WORKER_LEASE_MS must exceed the maximum configured run duration.',
    );
  }
  const provider = createModelProvider(config.model);
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
  const resources: OwnerResourceStore =
    config.storage.mode === 'memory'
      ? new InMemoryOwnerResourceStore()
      : new MongoDbOwnerResourceStore({
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
  const applicationStore: ChangeApplicationStore =
    config.storage.mode === 'memory'
      ? new InMemoryChangeApplicationStore()
      : new MongoDbChangeApplicationStore({
          uri: config.storage.mongodbUri,
          database: config.storage.mongodbDatabase,
          timeoutMs: config.storage.dependencyTimeoutMs,
        });
  const projectMutationLeases: ProjectMutationLeaseStore =
    config.storage.mode === 'memory'
      ? new InMemoryProjectMutationLeaseStore()
      : new MongoDbProjectMutationLeaseStore({
          uri: config.storage.mongodbUri,
          database: config.storage.mongodbDatabase,
          timeoutMs: config.storage.dependencyTimeoutMs,
        });
  const projectService = createProjectService({
    store: resources,
    resolveLocalGitRoot,
  });
  const conversationService = createConversationService({ store: resources });
  const artifactService = createArtifactService({ store: resources });
  const contextAssembler = new LocalGitProjectContextAssembler();
  const developmentPlanning = createDevelopmentPlanningCapabilityRegistry({
    config: {
      adapterId: config.planning.adapterId,
      codexCli: config.planning.adapters.codexCli,
      dependencyTimeoutMs: config.storage.dependencyTimeoutMs,
    },
    provider,
  });
  const softwareChange = createSoftwareChangeCapabilityRegistry({
    adapterId: config.change.adapterId,
    codexCli: config.change.adapters.codexCli,
    dependencyTimeoutMs: config.storage.dependencyTimeoutMs,
  });
  const webResearch = createWebResearchCapabilityRegistry(config.research);
  const personalTaskExecutor = new LocalPersonalTaskActionExecutor(resources);
  const reminderExecutor = new LocalReminderActionExecutor(resources);
  const memoryExecutor = new LocalMemoryActionExecutor(resources);
  const capabilities = createCapabilityRuntimeRegistry({
    developmentPlanning,
    softwareChange,
    webResearch,
    personalTasks: personalTaskExecutor,
    reminders: reminderExecutor,
    memories: memoryExecutor,
  });
  const personalTaskService = createPersonalTaskService({ store: resources });
  const reminderService = createReminderService({ store: resources });
  const notificationService = createNotificationService({ store: resources });
  const memoryService = createMemoryService({ store: resources });
  const capabilityService = createCapabilityService({ registry: capabilities });
  const evaluateModelDecision = createEvaluateModelDecision(
    provider,
    undefined,
    {
      enabledCapabilities: capabilities.enabledReferences(),
      ownerTimeZone: config.reminders.ownerTimeZone,
    },
  );
  const evaluateGoalContinuation = createEvaluateGoalContinuation(provider, {
    enabledCapabilities: capabilities.enabledReferences(),
    ownerTimeZone: config.reminders.ownerTimeZone,
  });
  const changeApplicationExecutor =
    new LocalGitSoftwareChangeApplicationExecutor({
      workspacesRoot: config.application.workspacesRoot,
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
    evaluateGoalContinuation,
    capabilities,
    resources,
    contextAssembler,
    conversationContextLimits: config.conversationContext,
    memoryContext: { enabled: provider.dataBoundary === 'owner_controlled' },
    ownerTimeZone: config.reminders.ownerTimeZone,
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
  const reminderDelivery = new VeraInboxReminderDelivery(resources);
  const reminderWorker = createReminderWorker({
    store: resources,
    delivery: reminderDelivery,
    concurrency: config.reminders.concurrency,
    pollIntervalMs: config.reminders.pollIntervalMs,
    leaseMs: config.reminders.leaseMs,
    warning: (error, context) => lifecycleObserver.warning(error, context),
  });
  const changeApplicationLifecycle = createSoftwareChangeApplicationLifecycle({
    store: applicationStore,
    resources,
    executor: changeApplicationExecutor,
    observer: lifecycleObserver,
  });
  const changeApplicationWorker = createSoftwareChangeApplicationWorker({
    store: applicationStore,
    leases: projectMutationLeases,
    lifecycle: changeApplicationLifecycle,
    concurrency: config.worker.concurrency,
    pollIntervalMs: config.worker.pollIntervalMs,
    leaseMs: config.worker.leaseMs,
    observer: lifecycleObserver,
    beforeWork: async () => {
      await Promise.all([
        applicationStore.checkReadiness(),
        resources.checkReadiness(),
      ]);
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
    artifacts: artifactService,
    conversations: conversationService,
    projects: projectService,
    capabilities: capabilityService,
    personalTasks: personalTaskService,
    reminders: reminderService,
    notifications: notificationService,
    memories: memoryService,
    changeApplications: {
      ...changeApplicationLifecycle,
      wake: () => changeApplicationWorker.wake(),
    },
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
      ...capabilities.declarations().flatMap((declaration) => {
        const runtime = capabilities.selected({
          name: declaration.definition.name,
          version: declaration.definition.version,
        });
        return runtime === null
          ? []
          : [
              {
                name: `${declaration.definition.name}_capability`,
                check: () => runtime.checkReadiness(),
              },
            ];
      }),
      { name: 'task_worker', check: () => worker.checkReadiness() },
      {
        name: 'reminder_worker',
        check: () => reminderWorker.checkReadiness(),
      },
      {
        name: 'change_application_store',
        check: () => applicationStore.checkReadiness(),
      },
      {
        name: 'change_application_executor',
        check: () => changeApplicationExecutor.checkReadiness(),
      },
      {
        name: 'change_application_worker',
        check: () => changeApplicationWorker.checkReadiness(),
      },
    ],
    close: async () => {
      await worker.stop();
      await reminderWorker.stop();
      await changeApplicationWorker.stop();
      await Promise.all([
        store.close(),
        scratchpad.close(),
        resources.close(),
        leases.close(),
        applicationStore.close(),
        projectMutationLeases.close(),
      ]);
    },
    logger: runtime.logger ?? true,
  });
  appReference.current = app;
  worker.start();
  reminderWorker.start();
  changeApplicationWorker.start();
  return app;
}
