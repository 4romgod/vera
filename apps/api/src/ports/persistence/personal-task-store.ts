import type {
  PersonalTask,
  PersonalTaskActionArguments,
} from '../../domain/personal-tasks/personal-task.ts';

export type PersonalTaskStore = {
  createPersonalTask(task: PersonalTask): Promise<PersonalTask>;
  listPersonalTasks(
    principalId: string,
    options: { status: 'all' | 'open' | 'completed'; limit: number },
  ): Promise<PersonalTask[]>;
  setPersonalTaskStatus(input: {
    principalId: string;
    taskId: string;
    status: 'open' | 'completed';
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<PersonalTask | null>;
  findPersonalTaskByCreationInvocation(
    principalId: string,
    invocationId: string,
  ): Promise<PersonalTask | null>;
  findPersonalTaskById(
    principalId: string,
    taskId: string,
  ): Promise<PersonalTask | null>;
};

export function personalTaskMutationOrderKey(
  mutationAt: string,
  invocationId: string,
): string {
  return `${mutationAt}\u0000${invocationId}`;
}

export function personalTaskIdForInvocation(invocationId: string): string {
  return `personal_task_${invocationId.slice('invocation_'.length)}`;
}

export type PersonalTaskStoreAction = PersonalTaskActionArguments;
