import type { ArtifactService } from '../../../application/artifacts/artifact-service.ts';
import type { ConversationService } from '../../../application/conversations/conversation-service.ts';
import type { ProjectService } from '../../../application/projects/project-service.ts';
import type { SoftwareChangeApplication } from '../../../domain/changes/software-change-application.ts';
import type { TaskAggregate } from '../../../domain/tasks/task-aggregate.ts';

export function taskResponse(aggregate: TaskAggregate) {
  return {
    schemaVersion: 1 as const,
    taskId: aggregate.task.id,
    runId: aggregate.run.id,
    taskStatus: aggregate.task.status,
    runStatus: aggregate.run.status,
    message: aggregate.task.message,
    ...(aggregate.task.projectId === undefined
      ? {}
      : { projectId: aggregate.task.projectId }),
    ...(aggregate.task.conversationId === undefined
      ? {}
      : { conversationId: aggregate.task.conversationId }),
    ...(aggregate.task.messageId === undefined
      ? {}
      : { messageId: aggregate.task.messageId }),
    createdAt: aggregate.task.createdAt,
    updatedAt: aggregate.task.updatedAt,
    ...(aggregate.run.decision === undefined
      ? {}
      : { decision: aggregate.run.decision }),
    ...(aggregate.run.approval === undefined
      ? {}
      : { approval: aggregate.run.approval }),
    ...(aggregate.run.approvalHistory === undefined
      ? {}
      : { approvalHistory: aggregate.run.approvalHistory }),
    ...(aggregate.run.invocation === undefined
      ? {}
      : { invocation: aggregate.run.invocation }),
    ...(aggregate.run.invocationHistory === undefined
      ? {}
      : { invocationHistory: aggregate.run.invocationHistory }),
    ...(aggregate.run.output === undefined
      ? {}
      : { output: aggregate.run.output }),
    ...(aggregate.run.failure === undefined
      ? {}
      : { failure: aggregate.run.failure }),
    ...(aggregate.run.budget === undefined
      ? {}
      : { budget: aggregate.run.budget }),
    ...(aggregate.run.conversationContext === undefined
      ? {}
      : {
          conversationContextManifest:
            aggregate.run.conversationContext.manifest,
        }),
    ...(aggregate.run.memoryContext === undefined
      ? {}
      : { memoryContextManifest: aggregate.run.memoryContext.manifest }),
    ...(aggregate.run.conversationReply === undefined
      ? {}
      : {
          conversationReply: {
            status: aggregate.run.conversationReply.status,
            messageId: aggregate.run.conversationReply.messageId,
            createdAt: aggregate.run.conversationReply.createdAt,
            ...(aggregate.run.conversationReply.projectedAt === undefined
              ? {}
              : {
                  projectedAt: aggregate.run.conversationReply.projectedAt,
                }),
          },
        }),
    ...(aggregate.run.goal === undefined ? {} : { goal: aggregate.run.goal }),
    links: {
      task: `/v1/tasks/${aggregate.task.id}`,
      run: `/v1/runs/${aggregate.run.id}`,
      events: `/v1/runs/${aggregate.run.id}/events`,
      ...(aggregate.run.approval === undefined
        ? {}
        : {
            approval: `/v1/approvals/${aggregate.run.approval.id}/decision`,
          }),
    },
  };
}

export function projectResponse(
  project: Awaited<ReturnType<ProjectService['getProject']>>,
) {
  const {
    principalId: ignoredPrincipal,
    registrationKey: ignoredKey,
    ...value
  } = project;
  void ignoredPrincipal;
  void ignoredKey;
  return value;
}

export function conversationResponse(
  conversation: Awaited<ReturnType<ConversationService['getConversation']>>,
) {
  const {
    principalId: ignoredPrincipal,
    creationKey: ignoredKey,
    ...value
  } = conversation;
  void ignoredPrincipal;
  void ignoredKey;
  return {
    ...value,
    messages: value.messages.map(
      ({ requestKey: ignoredRequest, ...message }) => {
        void ignoredRequest;
        return message;
      },
    ),
  };
}

export function artifactResponse(
  artifact: Awaited<ReturnType<ArtifactService['getArtifact']>>,
) {
  const { principalId: ignoredPrincipal, ...value } = artifact;
  void ignoredPrincipal;
  return value;
}

export function changeApplicationResponse(
  application: SoftwareChangeApplication,
) {
  const {
    principalId: ignoredPrincipal,
    requestKey: ignoredRequestKey,
    events: ignoredEvents,
    ...value
  } = application;
  void ignoredPrincipal;
  void ignoredRequestKey;
  void ignoredEvents;
  const terminal = [
    'succeeded',
    'rejected',
    'failed',
    'review_required',
    'cancelled',
  ].includes(application.status);
  return {
    ...value,
    links: {
      application: `/v1/change-applications/${application.id}`,
      events: `/v1/change-applications/${application.id}/events`,
      ...(application.status === 'awaiting_approval'
        ? { decision: `/v1/change-applications/${application.id}/decision` }
        : {}),
      ...(terminal
        ? {}
        : {
            cancellation: `/v1/change-applications/${application.id}/cancellation`,
          }),
    },
  };
}
