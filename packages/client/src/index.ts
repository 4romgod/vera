export type RunStatus =
  | 'deciding'
  | 'awaiting_approval'
  | 'executing'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'cancellation_requested'
  | 'cancelled';

export type CapabilityDestination = {
  schemaVersion: 1;
  adapterId: string;
  provider: string;
  transport: string;
  dataBoundary: 'owner_controlled' | 'third_party';
};

export type ContextManifest = {
  schemaVersion: 1;
  projectId: string;
  sourceKind: 'local_git';
  revision: string;
  generatedAt: string;
  entries: {
    relativePath: string;
    sha256: string;
    bytes: number;
    selectionReason: string;
    classification: string;
  }[];
  totalFiles: number;
  totalBytes: number;
  limits: { maxFiles: number; maxBytes: number; maxFileBytes: number };
  exclusions: string[];
};

export type Approval = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: 'specialist_capability_invocation';
  capability: { name: string; version: number };
  proposedArguments: Record<string, unknown>;
  project?: { id: string; displayName: string };
  contextManifest?: ContextManifest;
  destination?: CapabilityDestination;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type ArtifactReference = {
  id: string;
  version: number;
  type: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
};

export type TaskResource = {
  schemaVersion: 1;
  taskId: string;
  runId: string;
  taskStatus: string;
  runStatus: RunStatus;
  message: string;
  projectId?: string;
  conversationId?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
  decision?: unknown;
  approval?: Approval;
  invocation?: { destination?: CapabilityDestination } & Record<
    string,
    unknown
  >;
  output?: {
    kind: string;
    artifact?: ArtifactReference;
    [key: string]: unknown;
  };
  failure?: { code: string; message: string };
  budget?: unknown;
  links: {
    task: string;
    run: string;
    events: string;
    approval?: string;
  };
};

export type ProjectResource = {
  schemaVersion: 1;
  id: string;
  displayName: string;
  normalizedName: string;
  source: { kind: 'local_git'; rootPath: string };
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type ConversationResource = {
  schemaVersion: 1;
  id: string;
  title?: string;
  status: string;
  messages: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
};

export type ArtifactResource = {
  schemaVersion: 1;
  id: string;
  version: number;
  taskId: string;
  runId: string;
  invocationId: string;
  projectId: string;
  type: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  producer: { destination?: CapabilityDestination } & Record<string, unknown>;
  content: unknown;
  createdAt: string;
};

export type RunEventsResource = {
  schemaVersion: 1;
  taskId: string;
  runId: string;
  events: {
    schemaVersion: 1;
    id: string;
    sequence: number;
    type: string;
    occurredAt: string;
    data: Record<string, unknown>;
  }[];
};

export class VeraApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'VeraApiError';
  }
}

export type VeraApi = {
  registerProject(input: {
    displayName: string;
    rootPath: string;
    idempotencyKey: string;
  }): Promise<ProjectResource>;
  listProjects(): Promise<{ schemaVersion: 1; projects: ProjectResource[] }>;
  getProject(projectId: string): Promise<ProjectResource>;
  createConversation(input: {
    title?: string;
    idempotencyKey: string;
  }): Promise<ConversationResource>;
  listConversations(): Promise<{
    schemaVersion: 1;
    conversations: Record<string, unknown>[];
  }>;
  getConversation(conversationId: string): Promise<ConversationResource>;
  appendMessage(input: {
    conversationId: string;
    content: string;
    projectId?: string;
    idempotencyKey: string;
  }): Promise<TaskResource>;
  submitTask(input: {
    message: string;
    projectId?: string;
    idempotencyKey: string;
  }): Promise<TaskResource>;
  getTask(taskId: string): Promise<TaskResource>;
  getRun(runId: string): Promise<TaskResource>;
  getRunEvents(runId: string): Promise<RunEventsResource>;
  decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
  ): Promise<TaskResource>;
  cancelRun(runId: string): Promise<TaskResource>;
  getArtifact(artifactId: string): Promise<ArtifactResource>;
  waitForRun(runId: string, options?: WaitForRunOptions): Promise<TaskResource>;
};

export type WaitForRunOptions = {
  until?: (task: TaskResource) => boolean;
  onUpdate?: (task: TaskResource) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type Fetch = typeof globalThis.fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTaskResource(value: unknown): asserts value is TaskResource {
  const runStatuses: readonly string[] = [
    'deciding',
    'awaiting_approval',
    'executing',
    'succeeded',
    'rejected',
    'failed',
    'cancellation_requested',
    'cancelled',
  ];
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.taskId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.runStatus !== 'string' ||
    !runStatuses.includes(value.runStatus)
  ) {
    throw new Error('Vera returned an invalid task resource.');
  }
}

async function delay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw (
      signal.reason ??
      new DOMException('The operation was aborted.', 'AbortError')
    );
  }
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted.', 'AbortError'),
      );
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class VeraClient implements VeraApi {
  private readonly baseUrl: string;
  private readonly fetch: Fetch;

  public constructor(options?: { baseUrl?: string; fetch?: Fetch }) {
    this.baseUrl = (options?.baseUrl ?? 'http://127.0.0.1:4310').replace(
      /\/$/u,
      '',
    );
    this.fetch = options?.fetch ?? globalThis.fetch;
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
    conversations: Record<string, unknown>[];
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
        },
      },
    );
  }

  public submitTask(input: {
    message: string;
    projectId?: string;
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

  public getArtifact(artifactId: string): Promise<ArtifactResource> {
    return this.request(`/v1/artifacts/${encodeURIComponent(artifactId)}`);
  }

  public async waitForRun(
    runId: string,
    options?: WaitForRunOptions,
  ): Promise<TaskResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 600_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('waitForRun timeoutMs must be a positive number.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('waitForRun intervalMs must be a positive number.');
    }
    const terminal = new Set<RunStatus>([
      'succeeded',
      'rejected',
      'failed',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(`Timed out waiting for run ${runId}.`);
      }
      const timeoutSignal = AbortSignal.timeout(
        Math.max(1, timeoutMs - elapsedMs),
      );
      const signal =
        options?.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      let task: TaskResource;
      try {
        task = await this.taskRequest(`/v1/runs/${encodeURIComponent(runId)}`, {
          signal,
        });
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        if (timeoutSignal.aborted) {
          throw new Error(`Timed out waiting for run ${runId}.`, {
            cause: error,
          });
        }
        throw error;
      }
      options?.onUpdate?.(task);
      if (
        (options?.until ?? ((current) => terminal.has(current.runStatus)))(task)
      ) {
        return task;
      }
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  private async taskRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<TaskResource> {
    const value: unknown = await this.request(path, options);
    assertTaskResource(value);
    return value;
  }

  private async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        ...(options?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options?.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options?.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error =
        isRecord(body) && isRecord(body.error) ? body.error : undefined;
      const code =
        error !== undefined && typeof error.code === 'string'
          ? error.code
          : 'request_failed';
      const message =
        error !== undefined && typeof error.message === 'string'
          ? error.message
          : `Vera request failed with HTTP ${String(response.status)}.`;
      throw new VeraApiError(message, response.status, code, body);
    }
    return body as T;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  idempotencyKey?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};
