import type { Artifact } from '../../../../domain/artifacts/artifact.ts';
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from '../../../../domain/conversations/conversation.ts';
import type { Project } from '../../../../domain/projects/project.ts';
import {
  PersonalTaskSchema,
  type PersonalTask,
} from '../../../../domain/personal-tasks/personal-task.ts';
import type { OwnerResourceStore } from '../../../../ports/persistence/owner-resource-store.ts';
import { personalTaskMutationOrderKey } from '../../../../ports/persistence/personal-task-store.ts';

export class InMemoryOwnerResourceStore implements OwnerResourceStore {
  private readonly projects = new Map<string, Project>();
  private readonly projectIdByRegistration = new Map<string, string>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly conversationIdByCreation = new Map<string, string>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly artifactIdByInvocation = new Map<string, string>();
  private readonly personalTasks = new Map<string, PersonalTask>();
  private readonly personalTaskIdByCreationInvocation = new Map<
    string,
    string
  >();

  public createProject(
    project: Project,
  ): Promise<{ created: boolean; project: Project }> {
    const identity = this.identity(
      project.principalId,
      project.registrationKey,
    );
    const existingId = this.projectIdByRegistration.get(identity);
    if (existingId !== undefined) {
      const existing = this.projects.get(existingId);
      if (existing === undefined) {
        throw new Error('In-memory project index is inconsistent.');
      }
      return Promise.resolve({
        created: false,
        project: structuredClone(existing),
      });
    }
    this.projectIdByRegistration.set(identity, project.id);
    this.projects.set(project.id, structuredClone(project));
    return Promise.resolve({
      created: true,
      project: structuredClone(project),
    });
  }

  public findProjectById(
    principalId: string,
    projectId: string,
  ): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return Promise.resolve(
      project?.principalId === principalId ? structuredClone(project) : null,
    );
  }

  public listProjects(principalId: string): Promise<Project[]> {
    return Promise.resolve(
      [...this.projects.values()]
        .filter((project) => project.principalId === principalId)
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        )
        .map((project) => structuredClone(project)),
    );
  }

  public createConversation(
    conversation: Conversation,
  ): Promise<{ created: boolean; conversation: Conversation }> {
    const identity = this.identity(
      conversation.principalId,
      conversation.creationKey,
    );
    const existingId = this.conversationIdByCreation.get(identity);
    if (existingId !== undefined) {
      const existing = this.conversations.get(existingId);
      if (existing === undefined) {
        throw new Error('In-memory conversation index is inconsistent.');
      }
      return Promise.resolve({
        created: false,
        conversation: structuredClone(existing),
      });
    }
    this.conversationIdByCreation.set(identity, conversation.id);
    this.conversations.set(conversation.id, structuredClone(conversation));
    return Promise.resolve({
      created: true,
      conversation: structuredClone(conversation),
    });
  }

  public findConversationById(
    principalId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    const conversation = this.conversations.get(conversationId);
    return Promise.resolve(
      conversation?.principalId === principalId
        ? structuredClone(conversation)
        : null,
    );
  }

  public listConversations(
    principalId: string,
  ): Promise<ConversationSummary[]> {
    return Promise.resolve(
      [...this.conversations.values()]
        .filter((conversation) => conversation.principalId === principalId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((conversation) => {
          const lastMessage = conversation.messages.at(-1);
          return {
            schemaVersion: 1 as const,
            id: conversation.id,
            title: conversation.title,
            status: conversation.status,
            messageCount: conversation.messages.length,
            ...(lastMessage === undefined
              ? {}
              : {
                  lastMessage: (({
                    requestKey: ignoredRequestKey,
                    ...message
                  }) => {
                    void ignoredRequestKey;
                    return message;
                  })(structuredClone(lastMessage)),
                }),
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          };
        }),
    );
  }

  public appendMessage(
    principalId: string,
    conversationId: string,
    message: ConversationMessage,
  ): Promise<{
    created: boolean;
    conversation: Conversation;
    message: ConversationMessage;
  }> {
    const conversation = this.requireConversation(principalId, conversationId);
    const existing = conversation.messages.find(
      (candidate) =>
        candidate.role === message.role &&
        candidate.requestKey === message.requestKey,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        created: false,
        conversation: structuredClone(conversation),
        message: structuredClone(existing),
      });
    }
    conversation.messages.push(structuredClone(message));
    conversation.updatedAt = message.createdAt;
    return Promise.resolve({
      created: true,
      conversation: structuredClone(conversation),
      message: structuredClone(message),
    });
  }

  public attachTaskToMessage(
    principalId: string,
    conversationId: string,
    messageId: string,
    taskId: string,
  ): Promise<Conversation> {
    const conversation = this.requireConversation(principalId, conversationId);
    const message = conversation.messages.find(
      (candidate) => candidate.id === messageId,
    );
    if (message === undefined) {
      return Promise.reject(new Error(`Message ${messageId} was not found.`));
    }
    if (message.taskId !== undefined && message.taskId !== taskId) {
      return Promise.reject(
        new Error(`Message ${messageId} is already attached to another task.`),
      );
    }
    message.taskId = taskId;
    return Promise.resolve(structuredClone(conversation));
  }

  public createArtifact(
    artifact: Artifact,
  ): Promise<{ created: boolean; artifact: Artifact }> {
    const identity = this.identity(artifact.principalId, artifact.invocationId);
    const existingId = this.artifactIdByInvocation.get(identity);
    if (existingId !== undefined) {
      const existing = this.artifacts.get(existingId);
      if (existing === undefined) {
        throw new Error('In-memory artifact index is inconsistent.');
      }
      return Promise.resolve({
        created: false,
        artifact: structuredClone(existing),
      });
    }
    this.artifactIdByInvocation.set(identity, artifact.id);
    this.artifacts.set(artifact.id, structuredClone(artifact));
    return Promise.resolve({
      created: true,
      artifact: structuredClone(artifact),
    });
  }

  public findArtifactById(
    principalId: string,
    artifactId: string,
  ): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    return Promise.resolve(
      artifact?.principalId === principalId ? structuredClone(artifact) : null,
    );
  }

  public findArtifactByInvocationId(
    principalId: string,
    invocationId: string,
  ): Promise<Artifact | null> {
    const artifactId = this.artifactIdByInvocation.get(
      this.identity(principalId, invocationId),
    );
    return artifactId === undefined
      ? Promise.resolve(null)
      : this.findArtifactById(principalId, artifactId);
  }

  public createPersonalTask(task: PersonalTask): Promise<PersonalTask> {
    const identity = this.identity(task.principalId, task.creationInvocationId);
    const existingId = this.personalTaskIdByCreationInvocation.get(identity);
    if (existingId !== undefined) {
      const existing = this.personalTasks.get(existingId);
      if (existing === undefined) {
        throw new Error('In-memory personal task index is inconsistent.');
      }
      return Promise.resolve(structuredClone(existing));
    }
    const validated = PersonalTaskSchema.parse(task);
    this.personalTaskIdByCreationInvocation.set(identity, validated.id);
    this.personalTasks.set(validated.id, structuredClone(validated));
    return Promise.resolve(structuredClone(validated));
  }

  public listPersonalTasks(
    principalId: string,
    options: { status: 'all' | 'open' | 'completed'; limit: number },
  ): Promise<PersonalTask[]> {
    return Promise.resolve(
      [...this.personalTasks.values()]
        .filter(
          (task) =>
            task.principalId === principalId &&
            (options.status === 'all' || task.status === options.status),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, options.limit)
        .map((task) => structuredClone(task)),
    );
  }

  public setPersonalTaskStatus(input: {
    principalId: string;
    taskId: string;
    status: 'open' | 'completed';
    invocationId: string;
    mutationAt: string;
    recovery: boolean;
  }): Promise<PersonalTask | null> {
    const task = this.personalTasks.get(input.taskId);
    if (task?.principalId !== input.principalId) return Promise.resolve(null);
    if (task.lastMutation.invocationId === input.invocationId) {
      return Promise.resolve(structuredClone(task));
    }
    const requestedOrderKey = personalTaskMutationOrderKey(
      input.mutationAt,
      input.invocationId,
    );
    if (input.recovery && task.lastMutation.orderKey > requestedOrderKey) {
      return Promise.resolve(structuredClone(task));
    }
    const mutationAt =
      task.updatedAt >= input.mutationAt
        ? new Date(Date.parse(task.updatedAt) + 1).toISOString()
        : input.mutationAt;
    const orderKey = personalTaskMutationOrderKey(
      mutationAt,
      input.invocationId,
    );
    task.status = input.status;
    task.updatedAt = mutationAt;
    task.lastMutation = { invocationId: input.invocationId, orderKey };
    if (input.status === 'completed') task.completedAt = mutationAt;
    else delete task.completedAt;
    return Promise.resolve(structuredClone(task));
  }

  public findPersonalTaskByCreationInvocation(
    principalId: string,
    invocationId: string,
  ): Promise<PersonalTask | null> {
    const id = this.personalTaskIdByCreationInvocation.get(
      this.identity(principalId, invocationId),
    );
    if (id === undefined) return Promise.resolve(null);
    const task = this.personalTasks.get(id);
    return Promise.resolve(task === undefined ? null : structuredClone(task));
  }

  public findPersonalTaskById(
    principalId: string,
    taskId: string,
  ): Promise<PersonalTask | null> {
    const task = this.personalTasks.get(taskId);
    return Promise.resolve(
      task?.principalId === principalId ? structuredClone(task) : null,
    );
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  private requireConversation(
    principalId: string,
    conversationId: string,
  ): Conversation {
    const conversation = this.conversations.get(conversationId);
    if (conversation?.principalId !== principalId) {
      throw new Error(`Conversation ${conversationId} was not found.`);
    }
    return conversation;
  }

  private identity(principalId: string, localIdentity: string): string {
    return `${principalId}\u0000${localIdentity}`;
  }
}
