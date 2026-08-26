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

export type ConversationContextManifest = {
  schemaVersion: 1;
  conversationId: string;
  throughMessageId: string;
  scope: { kind: 'unscoped' } | { kind: 'project'; projectId: string };
  entries: {
    messageId: string;
    taskId: string;
    role: 'owner' | 'vera';
    sha256: string;
    characters: number;
  }[];
  totalMessages: number;
  totalCharacters: number;
  limits: { maxMessages: number; maxCharacters: number };
  exclusions: {
    differentScope: number;
    incompleteTurns: number;
    limits: number;
  };
};

export type Approval = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: 'specialist_capability_invocation';
  capability: { name: string; version: number };
  proposedArguments: Record<string, unknown>;
  project?: { id: string; displayName: string };
  contextManifest?: ContextManifest;
  inputArtifacts?: ArtifactReference[];
  destination?: CapabilityDestination;
  authority?: {
    approval: 'always';
    projectContext: 'required' | 'none';
    networkAccess: 'none' | 'provider_api' | 'public_web_via_provider';
    dataClasses: (
      | 'owner_request'
      | 'project_context'
      | 'artifact_content'
      | 'personal_task_data'
      | 'public_web'
    )[];
    sideEffects: (
      | 'third_party_disclosure'
      | 'isolated_workspace_write'
      | 'public_network_read'
      | 'personal_data_write'
    )[];
    credentials: 'none' | 'server_managed';
    maxWebSearchCalls?: number;
  };
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

type ArtifactReferenceIdentity = {
  id: string;
  version: 1;
  sha256: string;
  byteLength: number;
};

export type ArtifactReference = ArtifactReferenceIdentity &
  (
    | {
        type: 'implementation_plan';
        mediaType: 'application/vnd.vera.implementation-plan+json';
      }
    | {
        type: 'software_change';
        mediaType: 'application/vnd.vera.software-change+json';
      }
    | {
        type: 'research_report';
        mediaType: 'application/vnd.vera.research-report+json';
      }
    | {
        type: 'personal_task_result';
        mediaType: 'application/vnd.vera.personal-task-result+json';
      }
  );

export type PersonalTaskResource = {
  schemaVersion: 1;
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: 'open' | 'completed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type PersonalTaskResultContent = {
  schemaVersion: 1;
  action: 'create' | 'list' | 'complete' | 'reopen';
  summary: string;
  tasks: PersonalTaskResource[];
};

export type SoftwareChangeContent = {
  schemaVersion: 1;
  project: { id: string; name: string; revision: string };
  ticket: { reference: string; details: string };
  objective: string;
  summary: string;
  files: (
    | {
        relativePath: string;
        operation: 'create';
        afterSha256: string;
        bytes: number;
      }
    | {
        relativePath: string;
        operation: 'update';
        beforeSha256: string;
        afterSha256: string;
        bytes: number;
      }
    | {
        relativePath: string;
        operation: 'delete';
        beforeSha256: string;
        bytes: 0;
      }
  )[];
  patch: string;
  verification: {
    command: string;
    status: 'passed' | 'failed' | 'not_run';
    details: string;
  }[];
  risks: string[];
};

export type ResearchReportContent = {
  schemaVersion: 1;
  objective: string;
  report: string;
  sources: { title: string; url: string }[];
  searchedAt: string;
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
  approvalHistory?: Approval[];
  invocation?: { destination?: CapabilityDestination } & Record<
    string,
    unknown
  >;
  invocationHistory?: ({ destination?: CapabilityDestination } & Record<
    string,
    unknown
  >)[];
  output?:
    | { kind: 'response'; message?: string }
    | {
        kind: 'development_plan';
        plan?: unknown;
        artifact?: Extract<ArtifactReference, { type: 'implementation_plan' }>;
      }
    | {
        kind: 'software_change';
        change?: SoftwareChangeContent;
        artifact?: Extract<ArtifactReference, { type: 'software_change' }>;
      }
    | {
        kind: 'research_report';
        report?: ResearchReportContent;
        artifact?: Extract<ArtifactReference, { type: 'research_report' }>;
      }
    | {
        kind: 'personal_task_result';
        result?: PersonalTaskResultContent;
        artifact?: Extract<ArtifactReference, { type: 'personal_task_result' }>;
      }
    | {
        kind: 'goal_result';
        objective: string;
        summary: string;
        artifacts: ArtifactReference[];
      };
  failure?: { code: string; message: string };
  budget?: unknown;
  conversationContextManifest?: ConversationContextManifest;
  conversationReply?: {
    status: 'pending' | 'projected';
    messageId: string;
    createdAt: string;
    projectedAt?: string;
  };
  goal?: {
    schemaVersion: 1;
    objective: string;
    summary: string;
    status: 'active' | 'succeeded' | 'rejected' | 'failed' | 'cancelled';
    project?: { id: string; displayName: string };
    currentStepIndex: number;
    steps: {
      id: string;
      purpose: string;
      inputStepIds: string[];
      capability: string;
      version: number;
      arguments: Record<string, unknown>;
      status:
        | 'pending'
        | 'awaiting_approval'
        | 'executing'
        | 'succeeded'
        | 'rejected'
        | 'failed'
        | 'cancelled';
      approvalId?: string;
      invocationId?: string;
      artifact?: ArtifactReference;
    }[];
  };
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
  messages: ConversationMessageResource[];
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageResource = {
  id: string;
  role: 'owner' | 'vera';
  content: string;
  projectId?: string;
  taskId?: string;
  createdAt: string;
};

type ArtifactResourceIdentity = {
  schemaVersion: 1;
  id: string;
  version: 1;
  taskId: string;
  runId: string;
  invocationId: string;
  projectId?: string;
  sha256: string;
  byteLength: number;
  producer: { destination?: CapabilityDestination } & Record<string, unknown>;
  inputs?: ArtifactReference[];
  createdAt: string;
};

export type ArtifactResource = ArtifactResourceIdentity &
  (
    | {
        type: 'implementation_plan';
        mediaType: 'application/vnd.vera.implementation-plan+json';
        content: unknown;
      }
    | {
        type: 'software_change';
        mediaType: 'application/vnd.vera.software-change+json';
        content: SoftwareChangeContent;
      }
    | {
        type: 'research_report';
        mediaType: 'application/vnd.vera.research-report+json';
        content: ResearchReportContent;
      }
    | {
        type: 'personal_task_result';
        mediaType: 'application/vnd.vera.personal-task-result+json';
        content: PersonalTaskResultContent;
      }
  );

export type CapabilityCatalogResource = {
  schemaVersion: 1;
  capabilities: {
    name: string;
    version: number;
    description: string;
    effect: 'external' | 'owner_state';
    artifact: { type: string; mediaType: string };
    acceptedInputArtifacts: string[];
    authority: NonNullable<Approval['authority']>;
    enabled: boolean;
    destination?: CapabilityDestination;
  }[];
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

export type ChangeApplicationStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'applying'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'review_required'
  | 'cancellation_requested'
  | 'cancelled';

export type ChangeApplicationResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  status: ChangeApplicationStatus;
  sourceArtifact: { id: string; sha256: string };
  project: { id: string; displayName: string };
  approval: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: 'software_change_application';
    sourceArtifact: { id: string; sha256: string };
    project: { id: string; displayName: string };
    effect: {
      adapterId: 'local_git_worktree';
      baseRevision: string;
      branchName: string;
      workspacePath: string;
      patchSha256: string;
      staged: true;
      files: SoftwareChangeContent['files'];
    };
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
  };
  effect: {
    id: string;
    status:
      | 'pending'
      | 'executing'
      | 'succeeded'
      | 'failed'
      | 'review_required'
      | 'cancelled';
    startedAt?: string;
    completedAt?: string;
  };
  result?: {
    adapterId: 'local_git_worktree';
    baseRevision: string;
    branchName: string;
    workspacePath: string;
    patchSha256: string;
    staged: true;
    files: SoftwareChangeContent['files'];
    appliedAt: string;
  };
  failure?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  links: {
    application: string;
    events: string;
    decision?: string;
    cancellation?: string;
  };
};

export type ChangeApplicationEventsResource = {
  schemaVersion: 1;
  applicationId: string;
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
  listCapabilities(): Promise<CapabilityCatalogResource>;
  listPersonalTasks(options?: {
    status?: 'all' | 'open' | 'completed';
    limit?: number;
  }): Promise<{ schemaVersion: 1; tasks: PersonalTaskResource[] }>;
  getPersonalTask(taskId: string): Promise<PersonalTaskResource>;
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
  createChangeApplication(input: {
    artifactId: string;
    idempotencyKey: string;
  }): Promise<ChangeApplicationResource>;
  getChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource>;
  getChangeApplicationEvents(
    applicationId: string,
  ): Promise<ChangeApplicationEventsResource>;
  decideChangeApplication(input: {
    applicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<ChangeApplicationResource>;
  cancelChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource>;
  waitForChangeApplication(
    applicationId: string,
    options?: WaitForChangeApplicationOptions,
  ): Promise<ChangeApplicationResource>;
  waitForRun(runId: string, options?: WaitForRunOptions): Promise<TaskResource>;
};

export type WaitForRunOptions = {
  until?: (task: TaskResource) => boolean;
  onUpdate?: (task: TaskResource) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WaitForChangeApplicationOptions = {
  until?: (application: ChangeApplicationResource) => boolean;
  onUpdate?: (application: ChangeApplicationResource) => void;
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

function assertCapabilityCatalogResource(
  value: unknown,
): asserts value is CapabilityCatalogResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.some(
      (capability) =>
        !isRecord(capability) ||
        typeof capability.name !== 'string' ||
        typeof capability.version !== 'number' ||
        typeof capability.description !== 'string' ||
        !['external', 'owner_state'].includes(String(capability.effect)) ||
        typeof capability.enabled !== 'boolean' ||
        !isRecord(capability.artifact) ||
        typeof capability.artifact.type !== 'string' ||
        typeof capability.artifact.mediaType !== 'string' ||
        !isRecord(capability.authority),
    )
  ) {
    throw new Error('Vera returned an invalid capability catalog.');
  }
}

function assertPersonalTaskResource(
  value: unknown,
): asserts value is PersonalTaskResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('personal_task_') ||
    typeof value.title !== 'string' ||
    !['open', 'completed'].includes(String(value.status)) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Vera returned an invalid personal task resource.');
  }
}

function assertChangeApplicationResource(
  value: unknown,
): asserts value is ChangeApplicationResource {
  const statuses: readonly string[] = [
    'awaiting_approval',
    'approved',
    'applying',
    'succeeded',
    'rejected',
    'failed',
    'review_required',
    'cancellation_requested',
    'cancelled',
  ];
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('application_') ||
    typeof value.status !== 'string' ||
    !statuses.includes(value.status)
  ) {
    throw new Error('Vera returned an invalid change-application resource.');
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

  public async listCapabilities(): Promise<CapabilityCatalogResource> {
    const catalog = await this.request<unknown>('/v1/capabilities');
    assertCapabilityCatalogResource(catalog);
    return catalog;
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

  public createChangeApplication(input: {
    artifactId: string;
    idempotencyKey: string;
  }): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/artifacts/${encodeURIComponent(input.artifactId)}/applications`,
      { method: 'POST', idempotencyKey: input.idempotencyKey },
    );
  }

  public getChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/change-applications/${encodeURIComponent(applicationId)}`,
    );
  }

  public getChangeApplicationEvents(
    applicationId: string,
  ): Promise<ChangeApplicationEventsResource> {
    return this.request(
      `/v1/change-applications/${encodeURIComponent(applicationId)}/events`,
    );
  }

  public decideChangeApplication(input: {
    applicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/change-applications/${encodeURIComponent(input.applicationId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelChangeApplication(
    applicationId: string,
  ): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/change-applications/${encodeURIComponent(applicationId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public async waitForChangeApplication(
    applicationId: string,
    options?: WaitForChangeApplicationOptions,
  ): Promise<ChangeApplicationResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 600_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        'waitForChangeApplication timeoutMs must be a positive number.',
      );
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        'waitForChangeApplication intervalMs must be a positive number.',
      );
    }
    const terminal = new Set<ChangeApplicationStatus>([
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(
          `Timed out waiting for change application ${applicationId}.`,
        );
      }
      const timeoutSignal = AbortSignal.timeout(
        Math.max(1, timeoutMs - elapsedMs),
      );
      const signal =
        options?.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      let application: ChangeApplicationResource;
      try {
        application = await this.changeApplicationRequest(
          `/v1/change-applications/${encodeURIComponent(applicationId)}`,
          { signal },
        );
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        if (timeoutSignal.aborted) {
          throw new Error(
            `Timed out waiting for change application ${applicationId}.`,
            { cause: error },
          );
        }
        throw error;
      }
      options?.onUpdate?.(application);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(
          application,
        )
      ) {
        return application;
      }
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
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
        (
          options?.until ??
          ((current) =>
            terminal.has(current.runStatus) &&
            (current.conversationId === undefined ||
              current.conversationReply?.status === 'projected'))
        )(task)
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

  private async changeApplicationRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<ChangeApplicationResource> {
    const value: unknown = await this.request(path, options);
    assertChangeApplicationResource(value);
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
