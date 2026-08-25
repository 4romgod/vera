import type { Artifact } from '../domain/artifact.ts';
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from '../domain/conversation.ts';
import type { Project } from '../domain/project.ts';

export type ResourceStore = {
  createProject(
    project: Project,
  ): Promise<{ created: boolean; project: Project }>;
  findProjectById(
    principalId: string,
    projectId: string,
  ): Promise<Project | null>;
  listProjects(principalId: string): Promise<Project[]>;

  createConversation(
    conversation: Conversation,
  ): Promise<{ created: boolean; conversation: Conversation }>;
  findConversationById(
    principalId: string,
    conversationId: string,
  ): Promise<Conversation | null>;
  listConversations(principalId: string): Promise<ConversationSummary[]>;
  appendMessage(
    principalId: string,
    conversationId: string,
    message: ConversationMessage,
  ): Promise<{
    created: boolean;
    conversation: Conversation;
    message: ConversationMessage;
  }>;
  attachTaskToMessage(
    principalId: string,
    conversationId: string,
    messageId: string,
    taskId: string,
  ): Promise<Conversation>;

  createArtifact(
    artifact: Artifact,
  ): Promise<{ created: boolean; artifact: Artifact }>;
  findArtifactById(
    principalId: string,
    artifactId: string,
  ): Promise<Artifact | null>;
  findArtifactByInvocationId(
    principalId: string,
    invocationId: string,
  ): Promise<Artifact | null>;

  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
