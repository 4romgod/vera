import type {
  AttachmentResource,
  MachineCatalogResource,
  PersonalTaskResource,
  NotificationResource,
  ReminderResource,
  MemoryResource,
  KnowledgeScope,
  KnowledgeSourceResource,
  KnowledgeSearchResponse,
  NotificationPage,
  NotificationStreamEvent,
  PushPreferences,
  NotificationDeviceResource,
  PushDeliveryResource,
  PushNotificationStatus,
  AttentionBriefing,
  SpeechTranscriptionResource,
  SpeechTranscriptionAudio,
  TaskResource,
  ProjectResource,
  ConversationResource,
  ConversationSummaryResource,
  ArtifactResource,
  CapabilityCatalogResource,
  RunEventsResource,
} from '../contracts/index.ts';
import {
  isRecord,
  assertAttachmentResource,
  assertCapabilityCatalogResource,
  assertMachineCatalogResource,
  assertSpeechTranscriptionResource,
  assertPersonalTaskResource,
  assertNotificationResource,
  assertReminderResource,
  assertMemoryResource,
  assertKnowledgeSourceResource,
  assertKnowledgeSearchResponse,
  assertAttentionBriefing,
  assertPushNotificationStatus,
  assertNotificationDeviceResource,
  assertPushDeliveryResource,
} from '../validation/index.ts';
import { VeraHttpTransport } from '../http/transport.ts';

export class OwnerDataClient extends VeraHttpTransport {
  public async listCapabilities(): Promise<CapabilityCatalogResource> {
    const catalog = await this.request<unknown>('/v1/capabilities');
    assertCapabilityCatalogResource(catalog);
    return catalog;
  }

  public async listMachines(): Promise<MachineCatalogResource> {
    const catalog = await this.request<unknown>('/v1/machines');
    assertMachineCatalogResource(catalog);
    return catalog;
  }

  public async getAttentionBriefing(): Promise<AttentionBriefing> {
    const briefing = await this.request<unknown>('/v1/attention');
    assertAttentionBriefing(briefing);
    return briefing;
  }

  public async decideAttention(input: {
    attentionItemId: string;
    decision: 'dismiss' | 'snooze' | 'restore';
    snoozedUntil?: string;
    idempotencyKey: string;
  }): Promise<AttentionBriefing> {
    const briefing = await this.request<unknown>(
      `/v1/attention-items/${encodeURIComponent(input.attentionItemId)}/decision`,
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        body: {
          decision: input.decision,
          ...(input.snoozedUntil === undefined
            ? {}
            : { snoozedUntil: input.snoozedUntil }),
        },
      },
    );
    assertAttentionBriefing(briefing);
    return briefing;
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
    assertAttachmentResource(body);
    return body;
  }

  public async getAttachment(
    attachmentId: string,
  ): Promise<AttachmentResource> {
    const value = await this.request<unknown>(
      `/v1/attachments/${encodeURIComponent(attachmentId)}`,
    );
    assertAttachmentResource(value);
    return value;
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
    assertSpeechTranscriptionResource(body);
    return body;
  }

  public async listPersonalTasks(
    options: {
      status?: 'all' | 'open' | 'completed';
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; tasks: PersonalTaskResource[] }> {
    const query = new URLSearchParams();
    if (options.status !== undefined) query.set('status', options.status);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const value = await this.request<unknown>(
      `/v1/personal-tasks${query.size === 0 ? '' : `?${query.toString()}`}`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.tasks)
    ) {
      throw new Error('Vera returned an invalid personal task collection.');
    }
    const tasks = value.tasks.map((task): PersonalTaskResource => {
      assertPersonalTaskResource(task);
      return task;
    });
    return { schemaVersion: 1, tasks };
  }

  public async getPersonalTask(taskId: string): Promise<PersonalTaskResource> {
    const value = await this.request<unknown>(
      `/v1/personal-tasks/${encodeURIComponent(taskId)}`,
    );
    assertPersonalTaskResource(value);
    return value;
  }

  public async listReminders(
    options: {
      status?: 'all' | ReminderResource['status'];
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; reminders: ReminderResource[] }> {
    const query = new URLSearchParams();
    if (options.status !== undefined) query.set('status', options.status);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const value = await this.request<unknown>(
      `/v1/reminders${query.size === 0 ? '' : `?${query.toString()}`}`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.reminders)
    ) {
      throw new Error('Vera returned an invalid reminder collection.');
    }
    const reminders = value.reminders.map((reminder): ReminderResource => {
      assertReminderResource(reminder);
      return reminder;
    });
    return { schemaVersion: 1, reminders };
  }

  public async getReminder(reminderId: string): Promise<ReminderResource> {
    const value = await this.request<unknown>(
      `/v1/reminders/${encodeURIComponent(reminderId)}`,
    );
    assertReminderResource(value);
    return value;
  }

  public async listMemories(
    options: {
      status?: 'active' | 'all';
      kind?: MemoryResource['kind'];
      scope?: MemoryResource['scope'];
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; memories: MemoryResource[] }> {
    const query = new URLSearchParams();
    if (options.status !== undefined) query.set('status', options.status);
    if (options.kind !== undefined) query.set('kind', options.kind);
    if (options.scope !== undefined) {
      query.set('scopeKind', options.scope.kind);
      if (options.scope.kind === 'project') {
        query.set('projectId', options.scope.projectId);
      }
    }
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const value = await this.request<unknown>(
      `/v1/memories${query.size === 0 ? '' : `?${query.toString()}`}`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.memories)
    ) {
      throw new Error('Vera returned an invalid memory collection.');
    }
    const memories = value.memories.map((memory): MemoryResource => {
      assertMemoryResource(memory);
      return memory;
    });
    return { schemaVersion: 1, memories };
  }

  public async getMemory(memoryId: string): Promise<MemoryResource> {
    const value = await this.request<unknown>(
      `/v1/memories/${encodeURIComponent(memoryId)}`,
    );
    assertMemoryResource(value);
    return value;
  }

  public async createKnowledgeSource(input: {
    title: string;
    scope: KnowledgeScope;
    sensitivity?: 'personal' | 'sensitive';
    attachmentIds: string[];
    analysisArtifactId?: string;
    idempotencyKey: string;
  }): Promise<KnowledgeSourceResource> {
    const value = await this.request<unknown>('/v1/knowledge-sources', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
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
    });
    assertKnowledgeSourceResource(value);
    return value;
  }

  public async listKnowledgeSources(
    options: {
      status?: 'active' | 'all';
      scope?: KnowledgeScope;
      limit?: number;
    } = {},
  ): Promise<{ schemaVersion: 1; sources: KnowledgeSourceResource[] }> {
    const query = new URLSearchParams();
    if (options.status !== undefined) query.set('status', options.status);
    if (options.scope !== undefined) {
      query.set('scopeKind', options.scope.kind);
      if (options.scope.kind === 'project') {
        query.set('projectId', options.scope.projectId);
      }
    }
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const value = await this.request<unknown>(
      `/v1/knowledge-sources${query.size === 0 ? '' : `?${query.toString()}`}`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.sources)
    ) {
      throw new Error('Vera returned an invalid knowledge collection.');
    }
    const sources = value.sources.map((source): KnowledgeSourceResource => {
      assertKnowledgeSourceResource(source);
      return source;
    });
    return { schemaVersion: 1, sources };
  }

  public async getKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSourceResource> {
    const value = await this.request<unknown>(
      `/v1/knowledge-sources/${encodeURIComponent(sourceId)}`,
    );
    assertKnowledgeSourceResource(value);
    return value;
  }

  public async removeKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSourceResource> {
    const value = await this.request<unknown>(
      `/v1/knowledge-sources/${encodeURIComponent(sourceId)}`,
      { method: 'DELETE' },
    );
    assertKnowledgeSourceResource(value);
    return value;
  }

  public async searchKnowledge(input: {
    query: string;
    scope?: KnowledgeScope;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<KnowledgeSearchResponse> {
    const value = await this.request<unknown>('/v1/knowledge-search', {
      method: 'POST',
      body: {
        query: input.query,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    assertKnowledgeSearchResponse(value);
    return value;
  }

  public async listNotifications(
    options: { after?: string; limit?: number } = {},
  ): Promise<NotificationPage> {
    const query = new URLSearchParams();
    if (options.after !== undefined) query.set('after', options.after);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const value = await this.request<unknown>(
      `/v1/notifications${query.size === 0 ? '' : `?${query.toString()}`}`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.notifications) ||
      (value.nextCursor !== undefined && typeof value.nextCursor !== 'string')
    ) {
      throw new Error('Vera returned an invalid notification collection.');
    }
    const notifications = value.notifications.map(
      (notification): NotificationResource => {
        assertNotificationResource(notification);
        return notification;
      },
    );
    return {
      schemaVersion: 1,
      notifications,
      ...(value.nextCursor === undefined
        ? {}
        : { nextCursor: value.nextCursor }),
    };
  }

  public async getPushNotificationStatus(): Promise<PushNotificationStatus> {
    const value = await this.request<unknown>('/v1/push-notifications/status');
    assertPushNotificationStatus(value);
    return value;
  }
  public async listNotificationDevices(): Promise<{
    schemaVersion: 1;
    devices: NotificationDeviceResource[];
  }> {
    const value = await this.request<unknown>('/v1/notification-devices');
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.devices)
    )
      throw new Error('Vera returned an invalid notification-device list.');
    const devices = value.devices.map((device: unknown) => {
      assertNotificationDeviceResource(device);
      return device;
    });
    return { schemaVersion: 1, devices };
  }
  public async registerNotificationDevice(input: {
    installationId: string;
    provider: 'expo';
    projectId: string;
    pushToken: string;
    platform: 'ios' | 'android';
    name: string;
  }): Promise<NotificationDeviceResource> {
    const value = await this.request<unknown>('/v1/notification-devices', {
      method: 'POST',
      body: input,
    });
    assertNotificationDeviceResource(value);
    return value;
  }
  public async updateNotificationPreferences(
    deviceId: string,
    preferences: PushPreferences,
  ): Promise<NotificationDeviceResource> {
    const value = await this.request<unknown>(
      `/v1/notification-devices/${encodeURIComponent(deviceId)}/preferences`,
      { method: 'PUT', body: preferences },
    );
    assertNotificationDeviceResource(value);
    return value;
  }
  public async revokeNotificationDevice(
    deviceId: string,
  ): Promise<NotificationDeviceResource> {
    const value = await this.request<unknown>(
      `/v1/notification-devices/${encodeURIComponent(deviceId)}/revoke`,
      { method: 'POST' },
    );
    assertNotificationDeviceResource(value);
    return value;
  }
  public async testNotificationDevice(
    deviceId: string,
    idempotencyKey: string,
  ): Promise<PushDeliveryResource> {
    const value = await this.request<unknown>(
      `/v1/notification-devices/${encodeURIComponent(deviceId)}/test`,
      { method: 'POST', idempotencyKey },
    );
    assertPushDeliveryResource(value);
    return value;
  }
  public async listPushDeliveries(): Promise<{
    schemaVersion: 1;
    deliveries: PushDeliveryResource[];
  }> {
    const value = await this.request<unknown>('/v1/push-deliveries');
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.deliveries)
    )
      throw new Error('Vera returned an invalid push-delivery list.');
    const deliveries = value.deliveries.map((delivery: unknown) => {
      assertPushDeliveryResource(delivery);
      return delivery;
    });
    return { schemaVersion: 1, deliveries };
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
        const notification: unknown = JSON.parse(data);
        assertNotificationResource(notification);
        yield { cursor, notification };
      }
    }
  }

  public registerProject(input: {
    displayName: string;
    rootPath: string;
    idempotencyKey: string;
  }): Promise<ProjectResource> {
    return this.request('/v1/projects', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        displayName: input.displayName,
        source: { kind: 'local_git', rootPath: input.rootPath },
      },
    });
  }

  public listProjects(): Promise<{
    schemaVersion: 1;
    projects: ProjectResource[];
  }> {
    return this.request('/v1/projects');
  }

  public getProject(projectId: string): Promise<ProjectResource> {
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}`);
  }

  public createConversation(input: {
    title?: string;
    idempotencyKey: string;
  }): Promise<ConversationResource> {
    return this.request('/v1/conversations', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: input.title === undefined ? {} : { title: input.title },
    });
  }

  public listConversations(): Promise<{
    schemaVersion: 1;
    conversations: ConversationSummaryResource[];
  }> {
    return this.request('/v1/conversations');
  }

  public getConversation(
    conversationId: string,
  ): Promise<ConversationResource> {
    return this.request(
      `/v1/conversations/${encodeURIComponent(conversationId)}`,
    );
  }

  public appendMessage(input: {
    conversationId: string;
    content: string;
    projectId?: string;
    attachmentIds?: string[];
    idempotencyKey: string;
  }): Promise<TaskResource> {
    return this.taskRequest(
      `/v1/conversations/${encodeURIComponent(input.conversationId)}/messages`,
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
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
      },
    );
  }

  public submitTask(input: {
    message: string;
    projectId?: string;
    attachmentIds?: string[];
    idempotencyKey: string;
  }): Promise<TaskResource> {
    return this.taskRequest('/v1/tasks', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
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
    });
  }

  public getTask(taskId: string): Promise<TaskResource> {
    return this.taskRequest(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  public getRun(runId: string): Promise<TaskResource> {
    return this.taskRequest(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  public getRunEvents(runId: string): Promise<RunEventsResource> {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/events`);
  }

  public decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
  ): Promise<TaskResource> {
    return this.taskRequest(
      `/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
      { method: 'POST', body: { decision } },
    );
  }

  public cancelRun(runId: string): Promise<TaskResource> {
    return this.taskRequest(
      `/v1/runs/${encodeURIComponent(runId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public getArtifact(
    artifactId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArtifactResource> {
    return this.request(`/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  }
}
