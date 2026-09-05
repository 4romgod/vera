import type {
  AttachmentResource,
  MachineCatalogResource,
  PersonalTaskResource,
  ReminderResource,
  MemoryResource,
  KnowledgeSourceResource,
  KnowledgeSearchResponse,
  NotificationPage,
  NotificationDeviceResource,
  PushDeliveryResource,
  PushNotificationStatus,
  AttentionBriefing,
  SpeechTranscriptionResource,
  TaskResource,
  ProjectResource,
  ConversationResource,
  ArtifactResource,
  CapabilityCatalogResource,
  RunEventsResource,
} from '../generated/types.gen.ts';
import type {
  KnowledgeScope,
  ConversationSummaryResource,
  NotificationResource,
  NotificationStreamEvent,
  PushPreferences,
  SpeechTranscriptionAudio,
} from '../sdk-types.ts';
import {
  zGetV1NotificationsResponse,
  zPostV1AttachmentsResponse,
  zPostV1AudioTranscriptionsResponse,
} from '../generated/zod.gen.ts';
import {
  deleteV1KnowledgeSourcesId,
  getV1ArtifactsId,
  getV1AttachmentsId,
  getV1Attention,
  getV1Capabilities,
  getV1Conversations,
  getV1ConversationsId,
  getV1KnowledgeSources,
  getV1KnowledgeSourcesId,
  getV1Machines,
  getV1Memories,
  getV1MemoriesId,
  getV1NotificationDevices,
  getV1Notifications,
  getV1PersonalTasks,
  getV1PersonalTasksId,
  getV1Projects,
  getV1ProjectsId,
  getV1PushDeliveries,
  getV1PushNotificationsStatus,
  getV1Reminders,
  getV1RemindersId,
  getV1RunsId,
  getV1RunsIdEvents,
  getV1TasksId,
  postV1ApprovalsIdDecision,
  postV1AttentionItemsIdDecision,
  postV1Conversations,
  postV1ConversationsIdMessages,
  postV1KnowledgeSearch,
  postV1KnowledgeSources,
  postV1NotificationDevices,
  postV1NotificationDevicesIdRevoke,
  postV1NotificationDevicesIdTest,
  postV1Projects,
  postV1RunsIdCancellation,
  postV1Tasks,
  putV1NotificationDevicesIdPreferences,
} from '../generated/sdk.gen.ts';
import { VeraHttpTransport } from '../http/transport.ts';

export class OwnerDataClient extends VeraHttpTransport {
  public async listCapabilities(): Promise<CapabilityCatalogResource> {
    return this.generatedRequest(
      getV1Capabilities({ client: this.generatedClient }),
    );
  }

  public async listMachines(): Promise<MachineCatalogResource> {
    return this.generatedRequest(
      getV1Machines({ client: this.generatedClient }),
    );
  }

  public async getAttentionBriefing(): Promise<AttentionBriefing> {
    return this.generatedRequest(
      getV1Attention({ client: this.generatedClient }),
    );
  }

  public async decideAttention(input: {
    attentionItemId: string;
    decision: 'dismiss' | 'snooze' | 'restore';
    snoozedUntil?: string;
    idempotencyKey: string;
  }): Promise<AttentionBriefing> {
    return this.generatedRequest(
      postV1AttentionItemsIdDecision({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        path: { id: input.attentionItemId },
        body: {
          decision: input.decision,
          ...(input.snoozedUntil === undefined
            ? {}
            : { snoozedUntil: input.snoozedUntil }),
        },
      }),
    );
  }

  public async uploadAttachment(input: {
    filename: string;
    mediaType: AttachmentResource['mediaType'];
    bytes: ArrayBuffer | Blob;
    signal?: AbortSignal;
  }): Promise<AttachmentResource> {
    const response = await this.fetch(`${this.baseUrl}/v1/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-filename': encodeURIComponent(input.filename),
        'x-vera-media-type': input.mediaType,
      },
      body: input.bytes,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) throw this.errorFromBody(response.status, body);
    return zPostV1AttachmentsResponse.parseAsync(body);
  }

  public async getAttachment(
    attachmentId: string,
  ): Promise<AttachmentResource> {
    return this.generatedRequest(
      getV1AttachmentsId({
        client: this.generatedClient,
        path: { id: attachmentId },
      }),
    );
  }

  public attachmentPreviewUrl(attachmentId: string): string {
    return `${this.baseUrl}/v1/attachments/${encodeURIComponent(attachmentId)}/preview`;
  }

  public async transcribeAudio(input: {
    audio: SpeechTranscriptionAudio;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<SpeechTranscriptionResource> {
    const response = await this.fetch(
      `${this.baseUrl}/v1/audio/transcriptions`,
      {
        method: 'POST',
        headers: { 'content-type': input.contentType },
        body: input.audio,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) throw this.errorFromBody(response.status, body);
    return zPostV1AudioTranscriptionsResponse.parseAsync(body);
  }

  public async listPersonalTasks(
    options: {
      status?: 'all' | 'open' | 'completed';
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; tasks: PersonalTaskResource[] }> {
    return this.generatedRequest(
      getV1PersonalTasks({
        client: this.generatedClient,
        query: {
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
      }),
    );
  }

  public async getPersonalTask(taskId: string): Promise<PersonalTaskResource> {
    return this.generatedRequest(
      getV1PersonalTasksId({
        client: this.generatedClient,
        path: { id: taskId },
      }),
    );
  }

  public async listReminders(
    options: {
      status?: 'all' | ReminderResource['status'];
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; reminders: ReminderResource[] }> {
    return this.generatedRequest(
      getV1Reminders({
        client: this.generatedClient,
        query: {
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
      }),
    );
  }

  public async getReminder(reminderId: string): Promise<ReminderResource> {
    return this.generatedRequest(
      getV1RemindersId({
        client: this.generatedClient,
        path: { id: reminderId },
      }),
    );
  }

  public async listMemories(
    options: {
      status?: 'active' | 'all';
      kind?: MemoryResource['kind'];
      scope?: MemoryResource['scope'];
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; memories: MemoryResource[] }> {
    return this.generatedRequest(
      getV1Memories({
        client: this.generatedClient,
        query: {
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.kind === undefined ? {} : { kind: options.kind }),
          ...(options.scope === undefined
            ? {}
            : {
                scopeKind: options.scope.kind,
                ...(options.scope.kind === 'project'
                  ? { projectId: options.scope.projectId }
                  : {}),
              }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
      }),
    );
  }

  public async getMemory(memoryId: string): Promise<MemoryResource> {
    return this.generatedRequest(
      getV1MemoriesId({
        client: this.generatedClient,
        path: { id: memoryId },
      }),
    );
  }

  public async createKnowledgeSource(input: {
    title: string;
    scope: KnowledgeScope;
    sensitivity?: 'personal' | 'sensitive';
    attachmentIds: string[];
    analysisArtifactId?: string;
    idempotencyKey: string;
  }): Promise<KnowledgeSourceResource> {
    return this.generatedRequest(
      postV1KnowledgeSources({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          title: input.title,
          scope: input.scope,
          attachmentIds: input.attachmentIds,
          ...(input.sensitivity === undefined
            ? {}
            : { sensitivity: input.sensitivity }),
          ...(input.analysisArtifactId === undefined
            ? {}
            : { analysisArtifactId: input.analysisArtifactId }),
        },
      }),
    );
  }

  public async listKnowledgeSources(
    options: {
      status?: 'active' | 'all';
      scope?: KnowledgeScope;
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; sources: KnowledgeSourceResource[] }> {
    return this.generatedRequest(
      getV1KnowledgeSources({
        client: this.generatedClient,
        query: {
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.scope === undefined
            ? {}
            : {
                scopeKind: options.scope.kind,
                ...(options.scope.kind === 'project'
                  ? { projectId: options.scope.projectId }
                  : {}),
              }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
      }),
    );
  }

  public async getKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSourceResource> {
    return this.generatedRequest(
      getV1KnowledgeSourcesId({
        client: this.generatedClient,
        path: { id: sourceId },
      }),
    );
  }

  public async removeKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSourceResource> {
    return this.generatedRequest(
      deleteV1KnowledgeSourcesId({
        client: this.generatedClient,
        path: { id: sourceId },
      }),
    );
  }

  public async searchKnowledge(input: {
    query: string;
    scope?: KnowledgeScope;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<KnowledgeSearchResponse> {
    return this.generatedRequest(
      postV1KnowledgeSearch({
        client: this.generatedClient,
        body: {
          query: input.query,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
    );
  }

  public async listNotifications(
    options: { after?: string; limit?: number } = {},
  ): Promise<NotificationPage> {
    return this.generatedRequest(
      getV1Notifications({
        client: this.generatedClient,
        query: {
          ...(options.after === undefined ? {} : { after: options.after }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
      }),
    );
  }

  public async getPushNotificationStatus(): Promise<PushNotificationStatus> {
    return this.generatedRequest(
      getV1PushNotificationsStatus({ client: this.generatedClient }),
    );
  }
  public async listNotificationDevices(): Promise<{
    schemaVersion: 1;
    devices: NotificationDeviceResource[];
  }> {
    return this.generatedRequest(
      getV1NotificationDevices({ client: this.generatedClient }),
    );
  }
  public async registerNotificationDevice(input: {
    installationId: string;
    provider: 'expo';
    projectId: string;
    pushToken: string;
    platform: 'ios' | 'android';
    name: string;
  }): Promise<NotificationDeviceResource> {
    return this.generatedRequest(
      postV1NotificationDevices({
        client: this.generatedClient,
        body: input,
      }),
    );
  }
  public async updateNotificationPreferences(
    deviceId: string,
    preferences: PushPreferences,
  ): Promise<NotificationDeviceResource> {
    return this.generatedRequest(
      putV1NotificationDevicesIdPreferences({
        client: this.generatedClient,
        path: { id: deviceId },
        body: preferences,
      }),
    );
  }
  public async revokeNotificationDevice(
    deviceId: string,
  ): Promise<NotificationDeviceResource> {
    return this.generatedRequest(
      postV1NotificationDevicesIdRevoke({
        client: this.generatedClient,
        path: { id: deviceId },
      }),
    );
  }
  public async testNotificationDevice(
    deviceId: string,
    idempotencyKey: string,
  ): Promise<PushDeliveryResource> {
    return this.generatedRequest(
      postV1NotificationDevicesIdTest({
        client: this.generatedClient,
        headers: { 'idempotency-key': idempotencyKey },
        path: { id: deviceId },
      }),
    );
  }
  public async listPushDeliveries(): Promise<{
    schemaVersion: 1;
    deliveries: PushDeliveryResource[];
  }> {
    return this.generatedRequest(
      getV1PushDeliveries({ client: this.generatedClient }),
    );
  }

  public async *streamNotifications(
    options: { after?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<NotificationStreamEvent> {
    const query = new URLSearchParams();
    if (options.after !== undefined) query.set('after', options.after);
    const response = await this.fetch(
      `${this.baseUrl}/v1/notifications/stream${query.size === 0 ? '' : `?${query.toString()}`}`,
      {
        headers: { accept: 'text/event-stream' },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    if (!response.ok || response.body === null) {
      throw await this.apiError(response);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('Vera returned an invalid notification stream chunk.');
      }
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/gu, '\n');
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = block.split('\n');
        if (!lines.includes('event: notification')) continue;
        const cursor = lines
          .find((line) => line.startsWith('id:'))
          ?.slice(3)
          .trimStart();
        if (cursor === undefined || cursor.length === 0) {
          throw new Error(
            'Vera returned a notification event without a resume cursor.',
          );
        }
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data.length === 0) continue;
        const parsed: unknown = JSON.parse(data) as unknown;
        const page = await zGetV1NotificationsResponse.parseAsync({
          schemaVersion: 1,
          notifications: [parsed],
        });
        const notification = page.notifications[0] as
          | NotificationResource
          | undefined;
        if (notification === undefined)
          throw new Error('Vera returned an empty notification event.');
        yield { cursor, notification };
      }
    }
  }

  public async registerProject(input: {
    displayName: string;
    rootPath: string;
    idempotencyKey: string;
  }): Promise<ProjectResource> {
    return this.generatedData(
      await postV1Projects({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          displayName: input.displayName,
          source: { kind: 'local_git', rootPath: input.rootPath },
        },
      }),
    );
  }

  public async listProjects(): Promise<{
    schemaVersion: 1;
    projects: ProjectResource[];
  }> {
    return this.generatedData(
      await getV1Projects({ client: this.generatedClient }),
    );
  }

  public async getProject(projectId: string): Promise<ProjectResource> {
    return this.generatedData(
      await getV1ProjectsId({
        client: this.generatedClient,
        path: { id: projectId },
      }),
    );
  }

  public createConversation(input: {
    title?: string;
    idempotencyKey: string;
  }): Promise<ConversationResource> {
    return this.generatedRequest(
      postV1Conversations({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: input.title === undefined ? {} : { title: input.title },
      }),
    );
  }

  public listConversations(): Promise<{
    schemaVersion: 1;
    conversations: ConversationSummaryResource[];
  }> {
    return this.generatedRequest(
      getV1Conversations({ client: this.generatedClient }),
    );
  }

  public getConversation(
    conversationId: string,
  ): Promise<ConversationResource> {
    return this.generatedRequest(
      getV1ConversationsId({
        client: this.generatedClient,
        path: { id: conversationId },
      }),
    );
  }

  public appendMessage(input: {
    conversationId: string;
    content: string;
    projectId?: string;
    attachmentIds?: string[];
    idempotencyKey: string;
  }): Promise<TaskResource> {
    return this.generatedRequest(
      postV1ConversationsIdMessages({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        path: { id: input.conversationId },
        body: {
          content: input.content,
          ...(input.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          ...(input.attachmentIds === undefined ||
          input.attachmentIds.length === 0
            ? {}
            : { attachmentIds: input.attachmentIds }),
        },
      }),
    );
  }

  public submitTask(input: {
    message: string;
    projectId?: string;
    attachmentIds?: string[];
    idempotencyKey: string;
  }): Promise<TaskResource> {
    return this.generatedRequest(
      postV1Tasks({
        client: this.generatedClient,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          message: input.message,
          ...(input.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          ...(input.attachmentIds === undefined ||
          input.attachmentIds.length === 0
            ? {}
            : { attachmentIds: input.attachmentIds }),
        },
      }),
    );
  }

  public getTask(taskId: string): Promise<TaskResource> {
    return this.generatedRequest(
      getV1TasksId({
        client: this.generatedClient,
        path: { id: taskId },
      }),
    );
  }

  public getRun(runId: string): Promise<TaskResource> {
    return this.generatedRequest(
      getV1RunsId({
        client: this.generatedClient,
        path: { id: runId },
      }),
    );
  }

  public getRunEvents(runId: string): Promise<RunEventsResource> {
    return this.generatedRequest(
      getV1RunsIdEvents({
        client: this.generatedClient,
        path: { id: runId },
      }),
    );
  }

  public decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
  ): Promise<TaskResource> {
    return this.generatedRequest(
      postV1ApprovalsIdDecision({
        client: this.generatedClient,
        path: { id: approvalId },
        body: { decision },
      }),
    );
  }

  public cancelRun(runId: string): Promise<TaskResource> {
    return this.generatedRequest(
      postV1RunsIdCancellation({
        client: this.generatedClient,
        path: { id: runId },
      }),
    );
  }

  public async getArtifact(
    artifactId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArtifactResource> {
    return this.generatedRequest(
      getV1ArtifactsId({
        client: this.generatedClient,
        path: { id: artifactId },
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }
}
