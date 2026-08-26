import {
  PersonalTaskResourceSchema,
  personalTaskResource,
  type PersonalTaskResource,
} from '../../domain/personal-tasks/personal-task.ts';
import type { PersonalTaskStore } from '../../ports/persistence/personal-task-store.ts';
import { ResourceError } from '../shared/resource-error.ts';

export type PersonalTaskService = {
  list(
    principalId: string,
    options?: { status?: 'all' | 'open' | 'completed'; limit?: number },
  ): Promise<PersonalTaskResource[]>;
  get(principalId: string, taskId: string): Promise<PersonalTaskResource>;
};

export function createPersonalTaskService(options: {
  store: PersonalTaskStore;
}): PersonalTaskService {
  return {
    async list(principalId, query = {}) {
      const tasks = await options.store.listPersonalTasks(principalId, {
        status: query.status ?? 'open',
        limit: query.limit ?? 50,
      });
      return tasks.map((task) =>
        PersonalTaskResourceSchema.parse(personalTaskResource(task)),
      );
    },
    async get(principalId, taskId) {
      const task = await options.store.findPersonalTaskById(
        principalId,
        taskId,
      );
      if (task === null) {
        throw new ResourceError(
          `Personal task ${taskId} was not found.`,
          'personal_task_not_found',
        );
      }
      return personalTaskResource(task);
    },
  };
}
