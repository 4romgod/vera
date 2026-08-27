import type { FastifyInstance } from 'fastify';

import type { ConversationService } from '../../../../application/conversations/conversation-service.ts';
import type { TaskLifecycle } from '../../../../application/tasks/task-lifecycle.ts';
import type { AttachmentService } from '../../../../application/attachments/attachment-service.ts';
import { conversationResponse, taskResponse } from '../presenters.ts';
import {
  ConversationResponseJsonSchema,
  ConversationsResponseJsonSchema,
  CreateConversationMessageRequestJsonSchema,
  CreateConversationRequestJsonSchema,
  IdempotencyHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  TaskLifecycleResponseJsonSchema,
  type CreateConversationMessageRequest,
  type CreateConversationRequest,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerConversationRoutes(
  app: FastifyInstance,
  options: {
    principalId: string;
    conversations: ConversationService;
    taskLifecycle?: TaskLifecycle;
    attachments?: AttachmentService;
  },
): void {
  app.post<{
    Body: CreateConversationRequest;
    Headers: IdempotencyHeaders;
  }>(
    '/v1/conversations',
    {
      schema: {
        body: CreateConversationRequestJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 201: ConversationResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const conversation = await options.conversations.createConversation({
        principalId: options.principalId,
        creationKey: request.headers['idempotency-key'],
        ...(request.body.title === undefined
          ? {}
          : { title: request.body.title }),
      });
      return reply
        .status(201)
        .header('location', `/v1/conversations/${conversation.id}`)
        .send(conversationResponse(conversation));
    },
  );

  app.get(
    '/v1/conversations',
    { schema: { response: { 200: ConversationsResponseJsonSchema } } },
    async () => ({
      schemaVersion: 1 as const,
      conversations: await options.conversations.listConversations(
        options.principalId,
      ),
    }),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/conversations/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: ConversationResponseJsonSchema },
      },
    },
    async (request) =>
      conversationResponse(
        await options.conversations.getConversation(
          options.principalId,
          request.params.id,
        ),
      ),
  );

  if (options.taskLifecycle === undefined) return;
  const taskLifecycle = options.taskLifecycle;
  app.post<{
    Params: ResourceIdParams;
    Body: CreateConversationMessageRequest;
    Headers: IdempotencyHeaders;
  }>(
    '/v1/conversations/:id/messages',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: CreateConversationMessageRequestJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 202: TaskLifecycleResponseJsonSchema },
      },
    },
    async (request, reply) => {
      if (
        request.body.attachmentIds !== undefined &&
        options.attachments === undefined
      ) {
        throw new Error('Attachment service is not configured.');
      }
      const attachments = await options.attachments?.resolveReferences(
        options.principalId,
        request.body.attachmentIds ?? [],
      );
      const appended = await options.conversations.appendOwnerMessage({
        principalId: options.principalId,
        conversationId: request.params.id,
        requestKey: request.headers['idempotency-key'],
        content: request.body.content,
        ...(request.body.projectId === undefined
          ? {}
          : { projectId: request.body.projectId }),
        ...(attachments === undefined || attachments.length === 0
          ? {}
          : { attachments }),
      });
      const aggregate =
        appended.taskId === undefined
          ? await taskLifecycle.submit({
              principalId: options.principalId,
              requestKey: appended.messageId,
              message: request.body.content,
              conversationId: request.params.id,
              messageId: appended.messageId,
              ...(request.body.projectId === undefined
                ? {}
                : { projectId: request.body.projectId }),
              ...(attachments === undefined || attachments.length === 0
                ? {}
                : { attachments }),
            })
          : await taskLifecycle.getTask(options.principalId, appended.taskId);
      if (appended.taskId === undefined) {
        await options.conversations.attachTask({
          principalId: options.principalId,
          conversationId: request.params.id,
          messageId: appended.messageId,
          taskId: aggregate.task.id,
        });
      }
      return reply
        .status(202)
        .header('location', `/v1/tasks/${aggregate.task.id}`)
        .send(taskResponse(aggregate));
    },
  );
}
