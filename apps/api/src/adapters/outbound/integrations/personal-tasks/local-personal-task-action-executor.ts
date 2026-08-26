import {
  PersonalTaskActionArgumentsSchema,
  PersonalTaskResultSchema,
  personalTaskResource,
  type PersonalTaskActionArguments,
  type PersonalTaskResult,
} from '../../../../domain/personal-tasks/personal-task.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import type { CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import type { PersonalTaskStore } from '../../../../ports/persistence/personal-task-store.ts';
import {
  personalTaskIdForInvocation,
  personalTaskMutationOrderKey,
} from '../../../../ports/persistence/personal-task-store.ts';

export class LocalPersonalTaskActionExecutor
  implements
    IntegrationActionExecutor<PersonalTaskActionArguments, PersonalTaskResult>
{
  public readonly integrationId = 'vera_personal_tasks';
  public readonly destination = {
    schemaVersion: 1 as const,
    adapterId: 'vera_personal_tasks',
    provider: 'vera',
    transport: 'local_store',
    dataBoundary: 'owner_controlled' as const,
  };
  public readonly maximumAuthority: CapabilityAuthority = {
    approval: 'always' as const,
    projectContext: 'none' as const,
    networkAccess: 'none' as const,
    dataClasses: ['owner_request', 'personal_task_data'],
    sideEffects: ['personal_data_write'],
    credentials: 'none' as const,
  };

  public constructor(private readonly store: PersonalTaskStore) {}

  public authorityFor(
    arguments_: PersonalTaskActionArguments,
  ): CapabilityAuthority {
    return {
      ...this.maximumAuthority,
      sideEffects:
        arguments_.action === 'list' ? [] : this.maximumAuthority.sideEffects,
    };
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public async execute(
    input: {
      principalId: string;
      invocationId: string;
      startedAt: string;
      recovery: boolean;
      arguments: PersonalTaskActionArguments;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<PersonalTaskResult> {
    if (options.signal?.aborted === true) {
      throw new Error('Personal task action was aborted.');
    }
    const arguments_ = PersonalTaskActionArgumentsSchema.parse(input.arguments);
    if (arguments_.action === 'create') {
      const task = await this.store.createPersonalTask({
        schemaVersion: 1,
        id: personalTaskIdForInvocation(input.invocationId),
        principalId: input.principalId,
        title: arguments_.title,
        ...(arguments_.notes === undefined ? {} : { notes: arguments_.notes }),
        ...(arguments_.dueAt === undefined ? {} : { dueAt: arguments_.dueAt }),
        status: 'open',
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
        creationInvocationId: input.invocationId,
        lastMutation: {
          invocationId: input.invocationId,
          orderKey: personalTaskMutationOrderKey(
            input.startedAt,
            input.invocationId,
          ),
        },
      });
      if (task.lastMutation.invocationId !== input.invocationId) {
        throw new Error(
          `Personal task action ${input.invocationId} was superseded by a newer mutation.`,
        );
      }
      return PersonalTaskResultSchema.parse({
        schemaVersion: 1,
        action: 'create',
        summary: `Created personal task "${task.title}".`,
        tasks: [personalTaskResource(task)],
      });
    }
    if (arguments_.action === 'list') {
      const status = arguments_.status ?? 'open';
      const tasks = await this.store.listPersonalTasks(input.principalId, {
        status,
        limit: arguments_.limit ?? 50,
      });
      return PersonalTaskResultSchema.parse({
        schemaVersion: 1,
        action: 'list',
        summary: `Found ${String(tasks.length)} ${status === 'all' ? '' : `${status} `}personal task(s).`,
        tasks: tasks.map(personalTaskResource),
      });
    }
    const status = arguments_.action === 'complete' ? 'completed' : 'open';
    const task = await this.store.setPersonalTaskStatus({
      principalId: input.principalId,
      taskId: arguments_.taskId,
      status,
      invocationId: input.invocationId,
      mutationAt: input.startedAt,
      recovery: input.recovery,
    });
    if (task === null) {
      throw new Error(`Personal task ${arguments_.taskId} was not found.`);
    }
    if (task.lastMutation.invocationId !== input.invocationId) {
      throw new Error(
        `Personal task action ${input.invocationId} was superseded by a newer mutation.`,
      );
    }
    return PersonalTaskResultSchema.parse({
      schemaVersion: 1,
      action: arguments_.action,
      summary: `${arguments_.action === 'complete' ? 'Completed' : 'Reopened'} personal task "${task.title}".`,
      tasks: [personalTaskResource(task)],
    });
  }
}
