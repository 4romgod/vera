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

type AttachmentIdentity = {
  schemaVersion: 1;
  id: string;
  filename: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
};

export type AttachmentResource = AttachmentIdentity &
  (
    | {
        kind: 'document';
        mediaType:
          | 'text/plain'
          | 'text/markdown'
          | 'application/json'
          | 'application/pdf';
        extraction: {
          status: 'ready';
          extractor: 'vera_document_text_v1';
          totalCharacters: number;
          sha256: string;
        };
      }
    | {
        kind: 'image';
        mediaType:
          | 'image/jpeg'
          | 'image/png'
          | 'image/webp'
          | 'image/gif'
          | 'image/heic'
          | 'image/heif'
          | 'image/avif'
          | 'image/tiff';
        vision: {
          status: 'ready';
          processor: 'vera_image_vision_v1';
          mediaType: 'image/jpeg' | 'image/png';
          byteLength: number;
          sha256: string;
          width: number;
          height: number;
        };
      }
  );

export type AttachmentReference = Pick<
  AttachmentResource,
  'id' | 'kind' | 'filename' | 'mediaType' | 'byteLength' | 'sha256'
>;

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
  decisionEvidence?: ArtifactReference[];
  attachments?: AttachmentReference[];
  destination?: CapabilityDestination;
  authority?: {
    approval: 'always' | 'never';
    projectContext: 'required' | 'none';
    networkAccess:
      | 'none'
      | 'provider_api'
      | 'public_web_via_provider'
      | 'owner_machine';
    dataClasses: (
      | 'owner_request'
      | 'project_context'
      | 'artifact_content'
      | 'personal_task_data'
      | 'personal_reminder_data'
      | 'long_term_memory'
      | 'public_web'
      | 'attachment_content'
      | 'machine_operational_data'
      | 'mission_data'
      | 'personal_knowledge'
      | 'owner_attention'
      | 'routine_data'
    )[];
    sideEffects: (
      | 'third_party_disclosure'
      | 'isolated_workspace_write'
      | 'public_network_read'
      | 'personal_data_write'
      | 'scheduled_notification'
      | 'machine_service_control'
      | 'mission_draft_write'
      | 'knowledge_write'
      | 'standing_instruction_write'
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
    | {
        type: 'personal_reminder_result';
        mediaType: 'application/vnd.vera.personal-reminder-result+json';
      }
    | {
        type: 'memory_result';
        mediaType: 'application/vnd.vera.memory-result+json';
      }
    | {
        type: 'knowledge_result';
        mediaType: 'application/vnd.vera.knowledge-result+json';
      }
    | {
        type: 'attention_result';
        mediaType: 'application/vnd.vera.attention-result+json';
      }
    | {
        type: 'attachment_analysis';
        mediaType: 'application/vnd.vera.attachment-analysis+json';
      }
    | {
        type: 'machine_diagnostic';
        mediaType: 'application/vnd.vera.machine-diagnostic+json';
      }
    | {
        type: 'machine_service_action_result';
        mediaType: 'application/vnd.vera.machine-service-action-result+json';
      }
    | {
        type: 'mission_management_result';
        mediaType: 'application/vnd.vera.mission-management-result+json';
      }
    | {
        type: 'routine_management_result';
        mediaType: 'application/vnd.vera.routine-management-result+json';
      }
  );

export type MachineCatalogResource = {
  schemaVersion: 1;
  machines: {
    id: string;
    displayName: string;
    adapter: 'local' | 'ssh';
    diagnostics: { id: string; label: string }[];
    services: {
      id: string;
      displayName: string;
      actions: ('start' | 'stop' | 'restart')[];
    }[];
  }[];
};

export type MachineObservation = {
  status: 'healthy' | 'unhealthy' | 'unknown';
  checkedAt: string;
  durationMs: number;
  summary: string;
  exitCode?: number | null;
};

export type MachineDiagnosticContent = {
  schemaVersion: 1;
  machine: { id: string; displayName: string };
  adapter: 'local' | 'ssh';
  inspectedAt: string;
  system: {
    hostname: string;
    platform: string;
    architecture: string;
    uptimeSeconds?: number;
    freeMemoryBytes?: number;
    totalMemoryBytes?: number;
  };
  diagnostics: { id: string; label: string; observation: MachineObservation }[];
  services: {
    id: string;
    displayName: string;
    observation: MachineObservation;
  }[];
};

export type MachineServiceActionResultContent = {
  schemaVersion: 1;
  machine: { id: string; displayName: string };
  service: { id: string; displayName: string };
  action: 'start' | 'stop' | 'restart';
  before: MachineObservation;
  execution: { exitCode: number | null; summary: string };
  after: MachineObservation;
  verified: boolean;
  completedAt: string;
};

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

export type ReminderNotificationResource = {
  schemaVersion: 1;
  id: string;
  reminderId: string;
  message: string;
  scheduledFor: string;
  deliveredAt: string;
  status: 'unread' | 'acknowledged';
  channel: 'vera_inbox';
  acknowledgedAt?: string;
};

export type MissionNotificationResource = {
  schemaVersion: 1;
  id: string;
  missionId: string;
  message: string;
  deliveredAt: string;
  status: 'unread' | 'acknowledged';
  channel: 'vera_inbox';
  outcome: 'succeeded' | 'review_required' | 'failed' | 'cancelled';
  pullRequestUrl?: string;
  acknowledgedAt?: string;
};

export type NotificationResource =
  | ReminderNotificationResource
  | MissionNotificationResource;

export type ReminderResource = {
  schemaVersion: 1;
  id: string;
  message: string;
  scheduledFor: string;
  timeZone: string;
  status: 'scheduled' | 'delivered' | 'acknowledged' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  notification?: ReminderNotificationResource;
  cancelledAt?: string;
  acknowledgedAt?: string;
};

export type PersonalReminderResultContent = {
  schemaVersion: 1;
  action: 'create' | 'list' | 'reschedule' | 'cancel' | 'acknowledge';
  summary: string;
  reminders: ReminderResource[];
};

export type MemoryResource = {
  schemaVersion: 1;
  id: string;
  revision: number;
  kind: 'fact' | 'preference' | 'instruction' | 'project_knowledge';
  subject: string;
  content: string;
  scope: { kind: 'global' } | { kind: 'project'; projectId: string };
  sensitivity: 'personal' | 'sensitive';
  status: 'active' | 'forgotten';
  provenance: {
    source: 'owner_message';
    taskId: string;
    conversationId?: string;
    messageId?: string;
    invocationId: string;
  };
  history: {
    revision: number;
    kind: MemoryResource['kind'];
    subject: string;
    content: string;
    scope: MemoryResource['scope'];
    sensitivity: MemoryResource['sensitivity'];
    provenance: MemoryResource['provenance'];
    supersededAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
  forgottenAt?: string;
};

export type MemoryResultContent = {
  schemaVersion: 1;
  action: 'remember' | 'list' | 'correct' | 'forget';
  summary: string;
  memories: MemoryResource[];
};

export type KnowledgeScope =
  | { kind: 'global' }
  | { kind: 'project'; projectId: string };

export type KnowledgeSourceResource = {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  scope: KnowledgeScope;
  sensitivity: 'personal' | 'sensitive';
  status: 'active' | 'removed';
  provenance: {
    kind: 'owner_attachments';
    attachments: AttachmentReference[];
    analysisArtifact?: Extract<
      ArtifactReference,
      { type: 'attachment_analysis' }
    >;
  };
  contentSha256: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
};

export type KnowledgeSearchCitation = {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  locator: string;
  excerpt: string;
  score: number;
  attachments: AttachmentReference[];
};

export type KnowledgeSearchResponse = {
  schemaVersion: 1;
  query: string;
  citations: KnowledgeSearchCitation[];
  searchedAt: string;
};

export type KnowledgeResultContent = {
  schemaVersion: 1;
  action: 'add' | 'search' | 'list' | 'remove';
  summary: string;
  sources: KnowledgeSourceResource[];
  query?: string;
  answer?: string;
  citations?: KnowledgeSearchCitation[];
  limitations?: string[];
};

export type MemoryContextManifest = {
  schemaVersion: 1;
  principalId: string;
  projectId?: string;
  assembledAt: string;
  entries: {
    memoryId: string;
    revision: number;
    sha256: string;
    characters: number;
  }[];
  totalMemories: number;
  totalCharacters: number;
  sha256: string;
  limits: { maxMemories: number; maxCharacters: number };
  exclusions: { differentScope: number; limits: number };
};

export type NotificationPage = {
  schemaVersion: 1;
  notifications: NotificationResource[];
  nextCursor?: string;
};

export type NotificationStreamEvent = {
  cursor: string;
  notification: NotificationResource;
};

export type PushPreferences = {
  approvals: boolean;
  reminders: boolean;
  tasks: boolean;
  failures: boolean;
  results: boolean;
  quietHours?: {
    timeZone: string;
    startLocalTime: string;
    endLocalTime: string;
  };
};
export type NotificationDeviceResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  installationId: string;
  provider: 'expo';
  projectId: string;
  platform: 'ios' | 'android';
  name: string;
  status: 'active' | 'revoked' | 'invalid';
  preferences: PushPreferences;
  registeredAt: string;
  updatedAt: string;
  revokedAt?: string;
  invalidatedAt?: string;
  tokenSuffix: string;
};
export type PushDeliveryResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  deviceId: string;
  sourceId: string;
  category:
    | 'approvals'
    | 'reminders'
    | 'tasks'
    | 'failures'
    | 'results'
    | 'test';
  deepLink: string;
  status: 'queued' | 'accepted' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  nextAttemptAt: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};
export type PushNotificationStatus = {
  schemaVersion: 1;
  enabled: boolean;
  provider?: string;
  projectId?: string;
};

export type AttentionPriority = 'urgent' | 'high' | 'normal';
export type AttentionState = 'active' | 'snoozed' | 'dismissed';
export type AttentionTarget =
  | {
      kind: 'task';
      taskId: string;
      runId: string;
      conversationId?: string;
      approvalId?: string;
    }
  | { kind: 'personal_task'; personalTaskId: string }
  | { kind: 'reminder'; reminderId: string }
  | { kind: 'mission'; missionId: string }
  | { kind: 'campaign'; campaignId: string }
  | {
      kind: 'routine';
      routineId: string;
      routineRunId?: string;
      approvalId?: string;
    };

export type AttentionItem = {
  schemaVersion: 1;
  id: string;
  reason: string;
  priority: AttentionPriority;
  title: string;
  summary: string;
  occurredAt: string;
  target: AttentionTarget;
  state: AttentionState;
  snoozedUntil?: string;
};

export type AttentionBriefing = {
  schemaVersion: 1;
  generatedAt: string;
  headline: string;
  summary: string;
  counts: {
    urgent: number;
    high: number;
    normal: number;
    snoozed: number;
    dismissed: number;
  };
  items: AttentionItem[];
  snoozedItems: AttentionItem[];
  dismissedItems: AttentionItem[];
};

export type AttentionResultContent = {
  schemaVersion: 1;
  action: 'brief';
  summary: string;
  briefing: AttentionBriefing;
};

export type SpeechTranscriptionResource = {
  schemaVersion: 1;
  text: string;
  provider: string;
  model: string;
  durationMs: number;
};

export type SpeechTranscriptionAudio = Blob | ArrayBuffer;

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

export type AttachmentAnalysisContent = {
  schemaVersion: 1;
  objective: string;
  summary: string;
  findings: string[];
  citations: (
    | {
        kind: 'document';
        attachmentId: string;
        filename: string;
        locator: string;
        excerpt: string;
      }
    | { kind: 'image'; attachmentId: string; filename: string }
  )[];
  limitations: string[];
  attachments: Pick<
    AttachmentReference,
    'id' | 'kind' | 'filename' | 'mediaType' | 'sha256'
  >[];
  analyzedAt: string;
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
  attachments?: AttachmentReference[];
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
        kind: 'personal_reminder_result';
        result?: PersonalReminderResultContent;
        artifact?: Extract<
          ArtifactReference,
          { type: 'personal_reminder_result' }
        >;
      }
    | {
        kind: 'memory_result';
        result?: MemoryResultContent;
        artifact?: Extract<ArtifactReference, { type: 'memory_result' }>;
      }
    | {
        kind: 'knowledge_result';
        result?: KnowledgeResultContent;
        artifact?: Extract<ArtifactReference, { type: 'knowledge_result' }>;
      }
    | {
        kind: 'attention_result';
        result?: AttentionResultContent;
        artifact?: Extract<ArtifactReference, { type: 'attention_result' }>;
      }
    | {
        kind: 'attachment_analysis';
        analysis?: AttachmentAnalysisContent;
        artifact?: Extract<ArtifactReference, { type: 'attachment_analysis' }>;
      }
    | {
        kind: 'machine_diagnostic';
        diagnostic?: MachineDiagnosticContent;
        artifact?: Extract<ArtifactReference, { type: 'machine_diagnostic' }>;
      }
    | {
        kind: 'machine_service_action_result';
        result?: MachineServiceActionResultContent;
        artifact?: Extract<
          ArtifactReference,
          { type: 'machine_service_action_result' }
        >;
      }
    | {
        kind: 'mission_management_result';
        result?: {
          schemaVersion: 1;
          action: 'create';
          summary: string;
          mission: {
            id: string;
            status: 'awaiting_approval';
            objective: string;
          };
        };
        artifact?: Extract<
          ArtifactReference,
          { type: 'mission_management_result' }
        >;
      }
    | {
        kind: 'routine_management_result';
        result?: {
          schemaVersion: 1;
          action: 'create' | 'list' | 'pause' | 'resume' | 'run_now';
          summary: string;
          routine?: RoutineSummaryResource;
          routines?: RoutineSummaryResource[];
          run?: RoutineRunResource;
        };
        artifact?: Extract<
          ArtifactReference,
          { type: 'routine_management_result' }
        >;
      }
    | {
        kind: 'goal_result';
        objective: string;
        summary: string;
        artifacts: ArtifactReference[];
      }
    | {
        kind: 'adaptive_goal_result';
        objective: string;
        message: string;
        evidence: ArtifactReference[];
        artifacts: ArtifactReference[];
      };
  failure?: { code: string; message: string };
  budget?: unknown;
  conversationContextManifest?: ConversationContextManifest;
  memoryContextManifest?: MemoryContextManifest;
  conversationReply?: {
    status: 'pending' | 'projected';
    messageId: string;
    createdAt: string;
    projectedAt?: string;
  };
  goal?: {
    schemaVersion: 1 | 2;
    mode?: 'adaptive';
    objective: string;
    summary: string;
    completionCriteria?: string;
    requirements?: {
      id: string;
      description: string;
      capability: string;
      version: number;
      condition:
        | { kind: 'always' }
        | { kind: 'evidence_dependent'; description: string };
    }[];
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
    continuations?: ({
      decisionId: string;
      decision: Record<string, unknown>;
      model: Record<string, unknown>;
      decidedAt: string;
    } & Record<string, unknown>)[];
    finalResponse?: {
      message: string;
      evidence: ArtifactReference[];
      decisionId: string;
    };
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

export type ConversationSummaryResource = {
  schemaVersion: 1;
  id: string;
  title: string;
  status: 'active';
  messageCount: number;
  lastMessage?: ConversationMessageResource;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageResource = {
  id: string;
  role: 'owner' | 'vera';
  content: string;
  projectId?: string;
  taskId?: string;
  attachments?: AttachmentReference[];
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
    | {
        type: 'personal_reminder_result';
        mediaType: 'application/vnd.vera.personal-reminder-result+json';
        content: PersonalReminderResultContent;
      }
    | {
        type: 'memory_result';
        mediaType: 'application/vnd.vera.memory-result+json';
        content: MemoryResultContent;
      }
    | {
        type: 'knowledge_result';
        mediaType: 'application/vnd.vera.knowledge-result+json';
        content: KnowledgeResultContent;
      }
    | {
        type: 'attention_result';
        mediaType: 'application/vnd.vera.attention-result+json';
        content: AttentionResultContent;
      }
    | {
        type: 'attachment_analysis';
        mediaType: 'application/vnd.vera.attachment-analysis+json';
        content: AttachmentAnalysisContent;
      }
    | {
        type: 'machine_diagnostic';
        mediaType: 'application/vnd.vera.machine-diagnostic+json';
        content: MachineDiagnosticContent;
      }
    | {
        type: 'machine_service_action_result';
        mediaType: 'application/vnd.vera.machine-service-action-result+json';
        content: MachineServiceActionResultContent;
      }
    | {
        type: 'mission_management_result';
        mediaType: 'application/vnd.vera.mission-management-result+json';
        content: {
          schemaVersion: 1;
          action: 'create';
          summary: string;
          mission: {
            id: string;
            status: 'awaiting_approval';
            objective: string;
          };
        };
      }
    | {
        type: 'routine_management_result';
        mediaType: 'application/vnd.vera.routine-management-result+json';
        content: {
          schemaVersion: 1;
          action: 'create' | 'list' | 'pause' | 'resume' | 'run_now';
          summary: string;
          routine?: RoutineSummaryResource;
          routines?: RoutineSummaryResource[];
          run?: RoutineRunResource;
        };
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

export type ChangeApplicationListResource = {
  schemaVersion: 1;
  applications: ChangeApplicationResource[];
};

export type SoftwareChangePublicationStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'publishing'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'review_required'
  | 'cancelled';

export type SoftwareChangePublicationResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  status: SoftwareChangePublicationStatus;
  sourceApplication: { id: string; effectId: string; version: number };
  project: { id: string; displayName: string };
  approval: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: 'software_change_publication';
    effect: {
      adapterId: 'github_gh_cli';
      repository: { remoteName: 'origin'; owner: string; name: string };
      baseRevision: string;
      baseBranch: string;
      baseBranchRevision: string;
      headBranch: string;
      workspacePath: string;
      treeRevision: string;
      files: SoftwareChangeContent['files'];
      author: { name: string; email: string };
      commitMessage: string;
      pullRequest: { title: string; body: string; draft: boolean };
      authority: {
        commit: 'create_one';
        push: 'create_or_verify_head';
        pullRequest: 'create_or_verify';
        directBasePush: false;
        forcePush: false;
      };
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
    adapterId: 'github_gh_cli';
    commitRevision: string;
    remoteBranch: string;
    pullRequest: {
      number: number;
      url: string;
      baseBranch: string;
      headBranch: string;
      draft: boolean;
    };
    publishedAt: string;
  };
  failure?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  links: {
    publication: string;
    events: string;
    decision?: string;
    cancellation?: string;
  };
};

export type SoftwareChangePublicationEventsResource = {
  schemaVersion: 1;
  publicationId: string;
  events: {
    schemaVersion: 1;
    id: string;
    sequence: number;
    type: string;
    occurredAt: string;
    data: Record<string, unknown>;
  }[];
};

export type SoftwareChangePublicationListResource = {
  schemaVersion: 1;
  publications: SoftwareChangePublicationResource[];
};

export type DevelopmentCampaignStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'implementing'
  | 'applying'
  | 'verifying'
  | 'publishing'
  | 'observing'
  | 'merging'
  | 'synchronizing'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'review_required'
  | 'cancelled';

export type DevelopmentCampaignResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  requestKey: string;
  principalId: string;
  status: DevelopmentCampaignStatus;
  approval: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: 'development_campaign';
    effect: {
      adapterId: 'local_git_github';
      policyId: string;
      project: { id: string; displayName: string };
      repository: { owner: string; name: string };
      baseBranch: string;
      baseRevision: string;
      objective: string;
      completionMode: 'policy' | 'pull_request_only';
      approvalController?:
        | { kind: 'owner' }
        | { kind: 'mission'; missionId: string };
      ticket: { reference: string; details: string };
      delivery: {
        commitMessage: string;
        pullRequest: { title: string; body: string; draft: false };
      };
      capabilities: {
        name: 'development_planning' | 'software_change';
        version: 1;
        destination: CapabilityDestination;
        authority: NonNullable<Approval['authority']>;
      }[];
      qualityGates: {
        id: string;
        label: string;
        executable: string;
        arguments: string[];
        timeoutMs: number;
      }[];
      protectedPathPrefixes: string[];
      limits: {
        maxAttempts: number;
        maxChangedFiles: number;
        maxChangedBytes: number;
        maxDurationMinutes: number;
        minimumRequiredChecks: number;
      };
      merge: {
        enabled: boolean;
        method: 'squash' | 'merge' | 'rebase';
        requireReviewApproval: boolean;
        synchronizeLocalBase: boolean;
      };
      authority: {
        implementation: 'bounded_capabilities';
        application: 'exact_generated_patch';
        verification: 'configured_commands';
        publication: 'create_one_pull_request';
        observation: 'github_checks_and_reviews';
        merge: 'prohibited' | 'policy_gated_exact_head';
        directBasePush: false;
        forcePush: false;
        policyMutation: false;
      };
    };
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
  };
  attempts: {
    number: number;
    taskId: string;
    runId: string;
    artifactId?: string;
    applicationId?: string;
    verification?: {
      status: 'passed' | 'failed';
      checkedAt: string;
      gates: {
        id: string;
        label: string;
        status: 'passed' | 'failed';
        exitCode: number;
        durationMs: number;
        output: string;
      }[];
    };
  }[];
  publicationId?: string;
  pullRequest?: {
    number: number;
    url: string;
    headRevision: string;
    observation?: {
      checkedAt: string;
      state: 'OPEN' | 'CLOSED' | 'MERGED';
      headRevision: string;
      baseRevision: string;
      checks: {
        total: number;
        pending: number;
        passed: number;
        failed: number;
      };
      reviewDecision:
        | 'APPROVED'
        | 'CHANGES_REQUESTED'
        | 'REVIEW_REQUIRED'
        | 'NONE';
      mergeState: string;
    };
  };
  mergeResult?: {
    mergeRevision: string;
    baseRevision: string;
    mergedAt: string;
  };
  result?: {
    outcome: 'pull_request_ready' | 'merged';
    pullRequestNumber: number;
    pullRequestUrl: string;
    mergeRevision?: string;
    headRevision?: string;
    baseRevision: string;
    attempts: number;
    completedAt: string;
  };
  failure?: { code: string; message: string };
  events: {
    schemaVersion: 1;
    id: string;
    sequence: number;
    type: string;
    occurredAt: string;
    data: Record<string, unknown>;
  }[];
  createdAt: string;
  updatedAt: string;
};

export type MissionStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'succeeded'
  | 'rejected'
  | 'review_required'
  | 'failed'
  | 'cancelled';

export type MissionResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  requestKey: string;
  principalId: string;
  status: MissionStatus;
  approval: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: 'bounded_mission';
    effect: {
      policyId: string;
      objective: string;
      completionCriteria: string;
      project: { id: string; displayName: string };
      limits: { maxCampaigns: 1; maxDurationMinutes: number };
      campaign: {
        id: string;
        approvalId: string;
        effect: DevelopmentCampaignResource['approval']['effect'];
      };
      authority: {
        selectOneOutcome: true;
        createDevelopmentCampaigns: 1;
        createPullRequest: true;
        mergePullRequest: false;
        recurringExecution: false;
        missionPolicyMutation: false;
      };
    };
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
  };
  result?: {
    outcome: 'pull_request_ready';
    campaignId: string;
    pullRequestNumber: number;
    pullRequestUrl: string;
    completedAt: string;
  };
  failure?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
};

export type MissionPolicyResource = {
  schemaVersion: 1;
  id: string;
  project: { id: string; displayName: string };
  campaignPolicyId: string;
  limits: { maxCampaigns: 1; maxDurationMinutes: number };
  authority: MissionResource['approval']['effect']['authority'];
};

export type MissionListResource = {
  schemaVersion: 1;
  missions: MissionResource[];
};

export type MissionPolicyListResource = {
  schemaVersion: 1;
  policies: MissionPolicyResource[];
};

export type RoutineScheduleResource = {
  kind: 'daily';
  timeZone: string;
  localTime: string;
  daysOfWeek: number[];
};

export type RoutineResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  requestKey: string;
  principalId: string;
  status: 'awaiting_approval' | 'active' | 'paused' | 'rejected';
  approval: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: 'standing_instruction';
    effect: {
      title: string;
      schedule: RoutineScheduleResource;
      action: {
        kind: 'machine_health_check';
        machineId: string;
        serviceIds?: string[];
      };
      authority: {
        recurringExecution: true;
        inspectRegisteredMachine: true;
        controlMachineServices: false;
        modifyRoutine: false;
      };
    };
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
  };
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RoutineSummaryResource = Omit<
  RoutineResource,
  'requestKey' | 'principalId'
>;

export type RoutineRunResource = {
  schemaVersion: 1;
  version: number;
  id: string;
  routineId: string;
  principalId: string;
  occurrenceKey: string;
  trigger: 'scheduled' | 'manual';
  scheduledFor: string;
  action: RoutineResource['approval']['effect']['action'];
  status: 'queued' | 'executing' | 'succeeded' | 'failed' | 'cancelled';
  startedAt?: string;
  completedAt?: string;
  result?: {
    outcome: 'healthy' | 'attention_required';
    summary: string;
    diagnostic: MachineDiagnosticContent;
  };
  failure?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
};

export type DevelopmentCampaignListResource = {
  schemaVersion: 1;
  campaigns: DevelopmentCampaignResource[];
};

export type DevelopmentCampaignPolicyResource = {
  schemaVersion: 1;
  id: string;
  project: { id: string; displayName: string };
  baseBranch: string;
  qualityGates: { id: string; label: string; timeoutMs: number }[];
  limits: {
    maxAttempts: number;
    maxChangedFiles: number;
    maxChangedBytes: number;
    maxDurationMinutes: number;
    minimumRequiredChecks: number;
  };
  merge: {
    enabled: boolean;
    method: 'squash' | 'merge' | 'rebase';
    requireReviewApproval: boolean;
    synchronizeLocalBase: boolean;
  };
};

export type DevelopmentCampaignPolicyListResource = {
  schemaVersion: 1;
  policies: DevelopmentCampaignPolicyResource[];
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
  uploadAttachment(input: {
    filename: string;
    mediaType: AttachmentResource['mediaType'];
    bytes: ArrayBuffer | Blob;
    signal?: AbortSignal;
  }): Promise<AttachmentResource>;
  getAttachment(attachmentId: string): Promise<AttachmentResource>;
  attachmentPreviewUrl(attachmentId: string): string;
  transcribeAudio(input: {
    audio: SpeechTranscriptionAudio;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<SpeechTranscriptionResource>;
  listCapabilities(): Promise<CapabilityCatalogResource>;
  listMachines(): Promise<MachineCatalogResource>;
  getAttentionBriefing(): Promise<AttentionBriefing>;
  decideAttention(input: {
    attentionItemId: string;
    decision: 'dismiss' | 'snooze' | 'restore';
    snoozedUntil?: string;
    idempotencyKey: string;
  }): Promise<AttentionBriefing>;
  listPersonalTasks(options?: {
    status?: 'all' | 'open' | 'completed';
    limit?: number;
  }): Promise<{ schemaVersion: 1; tasks: PersonalTaskResource[] }>;
  getPersonalTask(taskId: string): Promise<PersonalTaskResource>;
  listReminders(options?: {
    status?: 'all' | ReminderResource['status'];
    limit?: number;
  }): Promise<{ schemaVersion: 1; reminders: ReminderResource[] }>;
  getReminder(reminderId: string): Promise<ReminderResource>;
  listMemories(options?: {
    status?: 'active' | 'all';
    kind?: MemoryResource['kind'];
    scope?: MemoryResource['scope'];
    limit?: number;
  }): Promise<{ schemaVersion: 1; memories: MemoryResource[] }>;
  getMemory(memoryId: string): Promise<MemoryResource>;
  createKnowledgeSource(input: {
    title: string;
    scope: KnowledgeScope;
    sensitivity?: 'personal' | 'sensitive';
    attachmentIds: string[];
    analysisArtifactId?: string;
    idempotencyKey: string;
  }): Promise<KnowledgeSourceResource>;
  listKnowledgeSources(options?: {
    status?: 'active' | 'all';
    scope?: KnowledgeScope;
    limit?: number;
  }): Promise<{ schemaVersion: 1; sources: KnowledgeSourceResource[] }>;
  getKnowledgeSource(sourceId: string): Promise<KnowledgeSourceResource>;
  removeKnowledgeSource(sourceId: string): Promise<KnowledgeSourceResource>;
  searchKnowledge(input: {
    query: string;
    scope?: KnowledgeScope;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<KnowledgeSearchResponse>;
  listNotifications(options?: {
    after?: string;
    limit?: number;
  }): Promise<NotificationPage>;
  streamNotifications(options?: {
    after?: string;
    signal?: AbortSignal;
  }): AsyncIterable<NotificationStreamEvent>;
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
    conversations: ConversationSummaryResource[];
  }>;
  getConversation(conversationId: string): Promise<ConversationResource>;
  appendMessage(input: {
    conversationId: string;
    content: string;
    projectId?: string;
    attachmentIds?: string[];
    idempotencyKey: string;
  }): Promise<TaskResource>;
  submitTask(input: {
    message: string;
    projectId?: string;
    attachmentIds?: string[];
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
  getArtifact(
    artifactId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArtifactResource>;
  createChangeApplication(input: {
    artifactId: string;
    idempotencyKey: string;
  }): Promise<ChangeApplicationResource>;
  listChangeApplicationsForArtifact(
    artifactId: string,
  ): Promise<ChangeApplicationListResource>;
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
  createSoftwareChangePublication(input: {
    applicationId: string;
    baseBranch: string;
    commitMessage: string;
    pullRequest: { title: string; body: string; draft: boolean };
    idempotencyKey: string;
  }): Promise<SoftwareChangePublicationResource>;
  listSoftwareChangePublicationsForApplication(
    applicationId: string,
  ): Promise<SoftwareChangePublicationListResource>;
  getSoftwareChangePublication(
    publicationId: string,
  ): Promise<SoftwareChangePublicationResource>;
  getSoftwareChangePublicationEvents(
    publicationId: string,
  ): Promise<SoftwareChangePublicationEventsResource>;
  decideSoftwareChangePublication(input: {
    publicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<SoftwareChangePublicationResource>;
  cancelSoftwareChangePublication(
    publicationId: string,
  ): Promise<SoftwareChangePublicationResource>;
  waitForSoftwareChangePublication(
    publicationId: string,
    options?: WaitForSoftwareChangePublicationOptions,
  ): Promise<SoftwareChangePublicationResource>;
  createDevelopmentCampaign(input: {
    projectId: string;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: {
      commitMessage: string;
      pullRequest: { title: string; body: string; draft: false };
    };
    idempotencyKey: string;
  }): Promise<DevelopmentCampaignResource>;
  listDevelopmentCampaignPolicies(): Promise<DevelopmentCampaignPolicyListResource>;
  listDevelopmentCampaigns(): Promise<DevelopmentCampaignListResource>;
  getDevelopmentCampaign(
    campaignId: string,
  ): Promise<DevelopmentCampaignResource>;
  decideDevelopmentCampaign(input: {
    campaignId: string;
    decision: 'approved' | 'rejected';
  }): Promise<DevelopmentCampaignResource>;
  cancelDevelopmentCampaign(
    campaignId: string,
  ): Promise<DevelopmentCampaignResource>;
  waitForDevelopmentCampaign(
    campaignId: string,
    options?: WaitForDevelopmentCampaignOptions,
  ): Promise<DevelopmentCampaignResource>;
  listMissionPolicies(): Promise<MissionPolicyListResource>;
  createMission(input: {
    projectId: string;
    policyId: string;
    objective: string;
    completionCriteria: string;
    delivery: { commitMessage: string; pullRequestTitle: string };
    idempotencyKey: string;
  }): Promise<MissionResource>;
  listMissions(): Promise<MissionListResource>;
  getMission(missionId: string): Promise<MissionResource>;
  decideMission(input: {
    missionId: string;
    decision: 'approved' | 'rejected';
  }): Promise<MissionResource>;
  cancelMission(missionId: string): Promise<MissionResource>;
  waitForMission(
    missionId: string,
    options?: WaitForMissionOptions,
  ): Promise<MissionResource>;
  listRoutines(): Promise<{ schemaVersion: 1; routines: RoutineResource[] }>;
  createRoutine(input: {
    title: string;
    schedule: RoutineScheduleResource;
    action: RoutineResource['approval']['effect']['action'];
    idempotencyKey: string;
  }): Promise<RoutineResource>;
  decideRoutine(input: {
    routineId: string;
    decision: 'approved' | 'rejected';
  }): Promise<RoutineResource>;
  pauseRoutine(routineId: string): Promise<RoutineResource>;
  resumeRoutine(routineId: string): Promise<RoutineResource>;
  runRoutineNow(input: {
    routineId: string;
    idempotencyKey: string;
  }): Promise<RoutineRunResource>;
  listRoutineRuns(
    routineId: string,
  ): Promise<{ schemaVersion: 1; runs: RoutineRunResource[] }>;
  getRoutineRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RoutineRunResource>;
  waitForRoutineRun(
    runId: string,
    options?: WaitForRoutineRunOptions,
  ): Promise<RoutineRunResource>;
  waitForRun(runId: string, options?: WaitForRunOptions): Promise<TaskResource>;
};

export type WaitForRoutineRunOptions = {
  until?: (run: RoutineRunResource) => boolean;
  onUpdate?: (run: RoutineRunResource) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
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

export type WaitForSoftwareChangePublicationOptions = {
  until?: (publication: SoftwareChangePublicationResource) => boolean;
  onUpdate?: (publication: SoftwareChangePublicationResource) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WaitForDevelopmentCampaignOptions = {
  until?: (campaign: DevelopmentCampaignResource) => boolean;
  onUpdate?: (campaign: DevelopmentCampaignResource) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WaitForMissionOptions = {
  until?: (mission: MissionResource) => boolean;
  onUpdate?: (mission: MissionResource) => void;
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

function assertAttachmentResource(
  value: unknown,
): asserts value is AttachmentResource {
  const validIdentity =
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    value.id.startsWith('attachment_') &&
    typeof value.filename === 'string' &&
    typeof value.byteLength === 'number' &&
    typeof value.sha256 === 'string' &&
    typeof value.createdAt === 'string';
  if (!validIdentity || !isRecord(value)) {
    throw new Error('Vera returned an invalid attachment resource.');
  }
  const validDocument =
    value.kind === 'document' &&
    [
      'text/plain',
      'text/markdown',
      'application/json',
      'application/pdf',
    ].includes(String(value.mediaType)) &&
    isRecord(value.extraction) &&
    value.extraction.status === 'ready' &&
    value.extraction.extractor === 'vera_document_text_v1' &&
    typeof value.extraction.totalCharacters === 'number' &&
    typeof value.extraction.sha256 === 'string';
  const validImage =
    value.kind === 'image' &&
    [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
      'image/avif',
      'image/tiff',
    ].includes(String(value.mediaType)) &&
    isRecord(value.vision) &&
    value.vision.status === 'ready' &&
    value.vision.processor === 'vera_image_vision_v1' &&
    ['image/jpeg', 'image/png'].includes(String(value.vision.mediaType)) &&
    typeof value.vision.byteLength === 'number' &&
    typeof value.vision.sha256 === 'string' &&
    typeof value.vision.width === 'number' &&
    typeof value.vision.height === 'number';
  if (!validDocument && !validImage) {
    throw new Error('Vera returned an invalid attachment resource.');
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

function assertMachineCatalogResource(
  value: unknown,
): asserts value is MachineCatalogResource {
  const hasOnlyKeys = (
    candidate: Record<string, unknown>,
    allowed: readonly string[],
  ) => Object.keys(candidate).every((key) => allowed.includes(key));
  const validDiagnostic = (diagnostic: unknown) =>
    isRecord(diagnostic) &&
    hasOnlyKeys(diagnostic, ['id', 'label']) &&
    typeof diagnostic.id === 'string' &&
    diagnostic.id.length > 0 &&
    typeof diagnostic.label === 'string' &&
    diagnostic.label.length > 0;
  const validService = (service: unknown) =>
    isRecord(service) &&
    hasOnlyKeys(service, ['id', 'displayName', 'actions']) &&
    typeof service.id === 'string' &&
    service.id.length > 0 &&
    typeof service.displayName === 'string' &&
    service.displayName.length > 0 &&
    Array.isArray(service.actions) &&
    service.actions.every((action) =>
      ['start', 'stop', 'restart'].includes(String(action)),
    );
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['schemaVersion', 'machines']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.machines) ||
    value.machines.some(
      (machine) =>
        !isRecord(machine) ||
        !hasOnlyKeys(machine, [
          'id',
          'displayName',
          'adapter',
          'diagnostics',
          'services',
        ]) ||
        typeof machine.id !== 'string' ||
        machine.id.length === 0 ||
        typeof machine.displayName !== 'string' ||
        machine.displayName.length === 0 ||
        !['local', 'ssh'].includes(String(machine.adapter)) ||
        !Array.isArray(machine.services) ||
        machine.services.some((service) => !validService(service)) ||
        !Array.isArray(machine.diagnostics) ||
        machine.diagnostics.some((diagnostic) => !validDiagnostic(diagnostic)),
    )
  ) {
    throw new Error('Vera returned an invalid machine catalog.');
  }
}

function assertSpeechTranscriptionResource(
  value: unknown,
): asserts value is SpeechTranscriptionResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.text !== 'string' ||
    value.text.trim().length === 0 ||
    typeof value.provider !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    throw new Error('Vera returned an invalid speech transcription.');
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

function assertNotificationResource(
  value: unknown,
): asserts value is NotificationResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('notification_') ||
    typeof value.message !== 'string' ||
    typeof value.deliveredAt !== 'string' ||
    !['unread', 'acknowledged'].includes(String(value.status)) ||
    value.channel !== 'vera_inbox'
  ) {
    throw new Error('Vera returned an invalid notification resource.');
  }
  const reminder =
    typeof value.reminderId === 'string' &&
    value.reminderId.startsWith('reminder_') &&
    typeof value.scheduledFor === 'string';
  const mission =
    typeof value.missionId === 'string' &&
    value.missionId.startsWith('mission_') &&
    ['succeeded', 'review_required', 'failed', 'cancelled'].includes(
      String(value.outcome),
    );
  if (!reminder && !mission) {
    throw new Error('Vera returned an invalid notification resource.');
  }
}

function assertReminderResource(
  value: unknown,
): asserts value is ReminderResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('reminder_') ||
    typeof value.message !== 'string' ||
    typeof value.scheduledFor !== 'string' ||
    typeof value.timeZone !== 'string' ||
    !['scheduled', 'delivered', 'acknowledged', 'cancelled'].includes(
      String(value.status),
    ) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Vera returned an invalid reminder resource.');
  }
  if (value.notification !== undefined) {
    assertNotificationResource(value.notification);
  }
}

function assertMemoryResource(value: unknown): asserts value is MemoryResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('memory_') ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.subject !== 'string' ||
    typeof value.content !== 'string' ||
    !['fact', 'preference', 'instruction', 'project_knowledge'].includes(
      String(value.kind),
    ) ||
    !['active', 'forgotten'].includes(String(value.status)) ||
    !['personal', 'sensitive'].includes(String(value.sensitivity)) ||
    !isMemoryScope(value.scope) ||
    !isMemoryProvenance(value.provenance) ||
    !Array.isArray(value.history) ||
    value.history.length > 100 ||
    value.history.some((entry) => !isMemoryHistoryEntry(entry)) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.forgottenAt !== undefined && typeof value.forgottenAt !== 'string')
  ) {
    throw new Error('Vera returned an invalid memory resource.');
  }
}

function isAttachmentReference(value: unknown): value is AttachmentReference {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.startsWith('attachment_') &&
    ['document', 'image'].includes(String(value.kind)) &&
    typeof value.filename === 'string' &&
    typeof value.mediaType === 'string' &&
    typeof value.byteLength === 'number' &&
    typeof value.sha256 === 'string'
  );
}

function assertKnowledgeSourceResource(
  value: unknown,
): asserts value is KnowledgeSourceResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('knowledge_') ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.title !== 'string' ||
    !isMemoryScope(value.scope) ||
    !['personal', 'sensitive'].includes(String(value.sensitivity)) ||
    !['active', 'removed'].includes(String(value.status)) ||
    !isRecord(value.provenance) ||
    value.provenance.kind !== 'owner_attachments' ||
    !Array.isArray(value.provenance.attachments) ||
    value.provenance.attachments.length === 0 ||
    value.provenance.attachments.some(
      (reference) => !isAttachmentReference(reference),
    ) ||
    typeof value.contentSha256 !== 'string' ||
    typeof value.chunkCount !== 'number' ||
    !Number.isInteger(value.chunkCount) ||
    value.chunkCount < 0 ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.removedAt !== undefined && typeof value.removedAt !== 'string')
  ) {
    throw new Error('Vera returned an invalid knowledge source.');
  }
}

function assertKnowledgeSearchResponse(
  value: unknown,
): asserts value is KnowledgeSearchResponse {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.query !== 'string' ||
    typeof value.searchedAt !== 'string' ||
    !Array.isArray(value.citations) ||
    value.citations.some(
      (citation) =>
        !isRecord(citation) ||
        typeof citation.sourceId !== 'string' ||
        !citation.sourceId.startsWith('knowledge_') ||
        typeof citation.sourceTitle !== 'string' ||
        typeof citation.chunkId !== 'string' ||
        typeof citation.locator !== 'string' ||
        typeof citation.excerpt !== 'string' ||
        typeof citation.score !== 'number' ||
        !Array.isArray(citation.attachments) ||
        citation.attachments.some(
          (reference) => !isAttachmentReference(reference),
        ),
    )
  ) {
    throw new Error('Vera returned invalid knowledge search results.');
  }
}

function isMemoryScope(value: unknown): value is MemoryResource['scope'] {
  return (
    isRecord(value) &&
    (value.kind === 'global' ||
      (value.kind === 'project' &&
        typeof value.projectId === 'string' &&
        value.projectId.startsWith('project_')))
  );
}

function isMemoryProvenance(
  value: unknown,
): value is MemoryResource['provenance'] {
  return (
    isRecord(value) &&
    value.source === 'owner_message' &&
    typeof value.taskId === 'string' &&
    value.taskId.startsWith('task_') &&
    typeof value.invocationId === 'string' &&
    value.invocationId.startsWith('invocation_') &&
    (value.conversationId === undefined ||
      (typeof value.conversationId === 'string' &&
        value.conversationId.startsWith('conversation_'))) &&
    (value.messageId === undefined ||
      (typeof value.messageId === 'string' &&
        value.messageId.startsWith('message_')))
  );
}

function isMemoryHistoryEntry(
  value: unknown,
): value is MemoryResource['history'][number] {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision > 0 &&
    ['fact', 'preference', 'instruction', 'project_knowledge'].includes(
      String(value.kind),
    ) &&
    typeof value.subject === 'string' &&
    typeof value.content === 'string' &&
    isMemoryScope(value.scope) &&
    ['personal', 'sensitive'].includes(String(value.sensitivity)) &&
    isMemoryProvenance(value.provenance) &&
    typeof value.supersededAt === 'string'
  );
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

function assertChangeApplicationListResource(
  value: unknown,
): asserts value is ChangeApplicationListResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.applications)
  ) {
    throw new Error('Vera returned an invalid change-application list.');
  }
  for (const application of value.applications) {
    assertChangeApplicationResource(application);
  }
}

function assertSoftwareChangePublicationResource(
  value: unknown,
): asserts value is SoftwareChangePublicationResource {
  const statuses: readonly string[] = [
    'awaiting_approval',
    'approved',
    'publishing',
    'succeeded',
    'rejected',
    'failed',
    'review_required',
    'cancelled',
  ];
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('publication_') ||
    typeof value.status !== 'string' ||
    !statuses.includes(value.status)
  ) {
    throw new Error(
      'Vera returned an invalid software-change publication resource.',
    );
  }
}

function assertSoftwareChangePublicationListResource(
  value: unknown,
): asserts value is SoftwareChangePublicationListResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.publications)
  ) {
    throw new Error('Vera returned an invalid software-publication list.');
  }
  for (const publication of value.publications) {
    assertSoftwareChangePublicationResource(publication);
  }
}

function assertDevelopmentCampaignResource(
  value: unknown,
): asserts value is DevelopmentCampaignResource {
  const statuses: readonly string[] = [
    'awaiting_approval',
    'approved',
    'implementing',
    'applying',
    'verifying',
    'publishing',
    'observing',
    'merging',
    'synchronizing',
    'succeeded',
    'rejected',
    'failed',
    'review_required',
    'cancelled',
  ];
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('campaign_') ||
    typeof value.version !== 'number' ||
    typeof value.status !== 'string' ||
    !statuses.includes(value.status) ||
    !isRecord(value.approval) ||
    !isRecord(value.approval.effect) ||
    value.approval.reason !== 'development_campaign' ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.events)
  ) {
    throw new Error('Vera returned an invalid development-campaign resource.');
  }
}

function assertDevelopmentCampaignListResource(
  value: unknown,
): asserts value is DevelopmentCampaignListResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.campaigns)
  ) {
    throw new Error('Vera returned an invalid development-campaign list.');
  }
  for (const campaign of value.campaigns) {
    assertDevelopmentCampaignResource(campaign);
  }
}

function assertDevelopmentCampaignPolicyListResource(
  value: unknown,
): asserts value is DevelopmentCampaignPolicyListResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.policies) ||
    value.policies.some(
      (policy) =>
        !isRecord(policy) ||
        policy.schemaVersion !== 1 ||
        typeof policy.id !== 'string' ||
        !isRecord(policy.project) ||
        typeof policy.project.id !== 'string' ||
        !Array.isArray(policy.qualityGates) ||
        !isRecord(policy.limits) ||
        !isRecord(policy.merge) ||
        typeof policy.merge.enabled !== 'boolean',
    )
  ) {
    throw new Error(
      'Vera returned an invalid development-campaign policy list.',
    );
  }
}

function assertMissionResource(
  value: unknown,
): asserts value is MissionResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('mission_') ||
    typeof value.version !== 'number' ||
    typeof value.status !== 'string' ||
    !isRecord(value.approval) ||
    value.approval.reason !== 'bounded_mission' ||
    !isRecord(value.approval.effect)
  ) {
    throw new Error('Vera returned an invalid mission resource.');
  }
}

function assertMissionListResource(
  value: unknown,
): asserts value is MissionListResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.missions)
  ) {
    throw new Error('Vera returned an invalid mission list.');
  }
  for (const mission of value.missions) assertMissionResource(mission);
}

function assertMissionPolicyListResource(
  value: unknown,
): asserts value is MissionPolicyListResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.policies) ||
    value.policies.some(
      (policy) =>
        !isRecord(policy) ||
        typeof policy.id !== 'string' ||
        !isRecord(policy.project) ||
        !isRecord(policy.limits) ||
        !isRecord(policy.authority),
    )
  ) {
    throw new Error('Vera returned an invalid mission policy list.');
  }
}

function assertRoutineResource(
  value: unknown,
): asserts value is RoutineResource {
  const validStatus = new Set([
    'awaiting_approval',
    'active',
    'paused',
    'rejected',
  ]);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('routine_') ||
    typeof value.version !== 'number' ||
    typeof value.requestKey !== 'string' ||
    typeof value.principalId !== 'string' ||
    typeof value.status !== 'string' ||
    !validStatus.has(value.status) ||
    !isRecord(value.approval) ||
    typeof value.approval.id !== 'string' ||
    !value.approval.id.startsWith('approval_') ||
    value.approval.reason !== 'standing_instruction' ||
    !['pending', 'approved', 'rejected'].includes(
      String(value.approval.status),
    ) ||
    !isRecord(value.approval.effect) ||
    typeof value.approval.effect.title !== 'string' ||
    !isRecord(value.approval.effect.schedule) ||
    value.approval.effect.schedule.kind !== 'daily' ||
    typeof value.approval.effect.schedule.timeZone !== 'string' ||
    typeof value.approval.effect.schedule.localTime !== 'string' ||
    !Array.isArray(value.approval.effect.schedule.daysOfWeek) ||
    !isRecord(value.approval.effect.action) ||
    value.approval.effect.action.kind !== 'machine_health_check' ||
    typeof value.approval.effect.action.machineId !== 'string' ||
    !isRecord(value.approval.effect.authority) ||
    value.approval.effect.authority.recurringExecution !== true ||
    value.approval.effect.authority.inspectRegisteredMachine !== true ||
    value.approval.effect.authority.controlMachineServices !== false ||
    value.approval.effect.authority.modifyRoutine !== false ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  )
    throw new Error('Vera returned an invalid routine resource.');
}

function assertRoutineRunResource(
  value: unknown,
): asserts value is RoutineRunResource {
  const validStatuses = new Set([
    'queued',
    'executing',
    'succeeded',
    'failed',
    'cancelled',
  ]);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('routine_run_') ||
    typeof value.routineId !== 'string' ||
    !value.routineId.startsWith('routine_') ||
    typeof value.principalId !== 'string' ||
    typeof value.occurrenceKey !== 'string' ||
    !['scheduled', 'manual'].includes(String(value.trigger)) ||
    typeof value.scheduledFor !== 'string' ||
    !isRecord(value.action) ||
    value.action.kind !== 'machine_health_check' ||
    typeof value.action.machineId !== 'string' ||
    typeof value.status !== 'string' ||
    !validStatuses.has(value.status) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.status === 'succeeded' &&
      (!isRecord(value.result) ||
        !['healthy', 'attention_required'].includes(
          String(value.result.outcome),
        ) ||
        typeof value.result.summary !== 'string' ||
        !isRecord(value.result.diagnostic))) ||
    (value.status === 'failed' &&
      (!isRecord(value.failure) ||
        typeof value.failure.code !== 'string' ||
        typeof value.failure.message !== 'string'))
  ) {
    throw new Error('Vera returned an invalid routine-run resource.');
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

function assertAttentionBriefing(
  value: unknown,
): asserts value is AttentionBriefing {
  const counts = isRecord(value) && isRecord(value.counts) ? value.counts : {};
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.generatedAt !== 'string' ||
    typeof value.headline !== 'string' ||
    typeof value.summary !== 'string' ||
    !['urgent', 'high', 'normal', 'snoozed', 'dismissed'].every(
      (key) => typeof counts[key] === 'number' && counts[key] >= 0,
    ) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.snoozedItems) ||
    !Array.isArray(value.dismissedItems)
  ) {
    throw new Error('Vera returned an invalid attention briefing.');
  }
  const collections = [
    value.items,
    value.snoozedItems,
    value.dismissedItems,
  ] as unknown[][];
  for (const collection of collections) {
    for (const item of collection) {
      if (
        !isRecord(item) ||
        item.schemaVersion !== 1 ||
        typeof item.id !== 'string' ||
        !item.id.startsWith('attention_') ||
        !['urgent', 'high', 'normal'].includes(String(item.priority)) ||
        !['active', 'snoozed', 'dismissed'].includes(String(item.state)) ||
        typeof item.title !== 'string' ||
        typeof item.summary !== 'string' ||
        !isRecord(item.target) ||
        !isAttentionTarget(item.target) ||
        (item.state === 'snoozed' && typeof item.snoozedUntil !== 'string')
      ) {
        throw new Error('Vera returned an invalid attention item.');
      }
    }
  }
}

function isAttentionTarget(value: Record<string, unknown>): boolean {
  switch (value.kind) {
    case 'task':
      return (
        typeof value.taskId === 'string' && typeof value.runId === 'string'
      );
    case 'personal_task':
      return typeof value.personalTaskId === 'string';
    case 'reminder':
      return typeof value.reminderId === 'string';
    case 'mission':
      return typeof value.missionId === 'string';
    case 'campaign':
      return typeof value.campaignId === 'string';
    case 'routine':
      return typeof value.routineId === 'string';
    default:
      return false;
  }
}

function assertPushNotificationStatus(
  value: unknown,
): asserts value is PushNotificationStatus {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.enabled !== 'boolean' ||
    (value.provider !== undefined && typeof value.provider !== 'string') ||
    (value.projectId !== undefined && typeof value.projectId !== 'string')
  ) {
    throw new Error('Vera returned invalid push-notification status.');
  }
}

function isPushPreferences(value: unknown): value is PushPreferences {
  if (!isRecord(value)) return false;
  for (const key of [
    'approvals',
    'reminders',
    'tasks',
    'failures',
    'results',
  ]) {
    if (typeof value[key] !== 'boolean') return false;
  }
  if (value.quietHours === undefined) return true;
  return (
    isRecord(value.quietHours) &&
    typeof value.quietHours.timeZone === 'string' &&
    typeof value.quietHours.startLocalTime === 'string' &&
    typeof value.quietHours.endLocalTime === 'string'
  );
}

function assertNotificationDeviceResource(
  value: unknown,
): asserts value is NotificationDeviceResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.version !== 'number' ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('notification_device_') ||
    typeof value.installationId !== 'string' ||
    value.provider !== 'expo' ||
    typeof value.projectId !== 'string' ||
    !['ios', 'android'].includes(String(value.platform)) ||
    typeof value.name !== 'string' ||
    !['active', 'revoked', 'invalid'].includes(String(value.status)) ||
    !isPushPreferences(value.preferences) ||
    typeof value.registeredAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.tokenSuffix !== 'string'
  ) {
    throw new Error('Vera returned an invalid notification device.');
  }
}

function assertPushDeliveryResource(
  value: unknown,
): asserts value is PushDeliveryResource {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.version !== 'number' ||
    typeof value.id !== 'string' ||
    !value.id.startsWith('push_delivery_') ||
    typeof value.deviceId !== 'string' ||
    typeof value.sourceId !== 'string' ||
    ![
      'approvals',
      'reminders',
      'tasks',
      'failures',
      'results',
      'test',
    ].includes(String(value.category)) ||
    typeof value.deepLink !== 'string' ||
    !['queued', 'accepted', 'delivered', 'failed', 'cancelled'].includes(
      String(value.status),
    ) ||
    typeof value.attempts !== 'number' ||
    typeof value.nextAttemptAt !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Vera returned an invalid push delivery.');
  }
}

export class VeraClient implements VeraApi {
  private readonly baseUrl: string;
  private readonly fetch: Fetch;

  public constructor(options?: { baseUrl?: string; fetch?: Fetch }) {
    this.baseUrl = (options?.baseUrl ?? 'http://127.0.0.1:4310').replace(
      /\/$/u,
      '',
    );
    this.fetch =
      options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

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

  public createChangeApplication(input: {
    artifactId: string;
    idempotencyKey: string;
  }): Promise<ChangeApplicationResource> {
    return this.changeApplicationRequest(
      `/v1/artifacts/${encodeURIComponent(input.artifactId)}/applications`,
      { method: 'POST', idempotencyKey: input.idempotencyKey },
    );
  }

  public async listChangeApplicationsForArtifact(
    artifactId: string,
  ): Promise<ChangeApplicationListResource> {
    const value: unknown = await this.request(
      `/v1/artifacts/${encodeURIComponent(artifactId)}/applications`,
    );
    assertChangeApplicationListResource(value);
    return value;
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

  public createSoftwareChangePublication(input: {
    applicationId: string;
    baseBranch: string;
    commitMessage: string;
    pullRequest: { title: string; body: string; draft: boolean };
    idempotencyKey: string;
  }): Promise<SoftwareChangePublicationResource> {
    return this.softwareChangePublicationRequest(
      `/v1/change-applications/${encodeURIComponent(input.applicationId)}/publications`,
      {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        body: {
          baseBranch: input.baseBranch,
          commitMessage: input.commitMessage,
          pullRequest: input.pullRequest,
        },
      },
    );
  }

  public async listSoftwareChangePublicationsForApplication(
    applicationId: string,
  ): Promise<SoftwareChangePublicationListResource> {
    const value: unknown = await this.request(
      `/v1/change-applications/${encodeURIComponent(applicationId)}/publications`,
    );
    assertSoftwareChangePublicationListResource(value);
    return value;
  }

  public getSoftwareChangePublication(publicationId: string) {
    return this.softwareChangePublicationRequest(
      `/v1/software-change-publications/${encodeURIComponent(publicationId)}`,
    );
  }

  public getSoftwareChangePublicationEvents(
    publicationId: string,
  ): Promise<SoftwareChangePublicationEventsResource> {
    return this.request(
      `/v1/software-change-publications/${encodeURIComponent(publicationId)}/events`,
    );
  }

  public decideSoftwareChangePublication(input: {
    publicationId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.softwareChangePublicationRequest(
      `/v1/software-change-publications/${encodeURIComponent(input.publicationId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelSoftwareChangePublication(publicationId: string) {
    return this.softwareChangePublicationRequest(
      `/v1/software-change-publications/${encodeURIComponent(publicationId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public async waitForSoftwareChangePublication(
    publicationId: string,
    options?: WaitForSoftwareChangePublicationOptions,
  ): Promise<SoftwareChangePublicationResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 600_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        'waitForSoftwareChangePublication timeoutMs must be a positive number.',
      );
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        'waitForSoftwareChangePublication intervalMs must be a positive number.',
      );
    }
    const terminal = new Set<SoftwareChangePublicationStatus>([
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(`Timed out waiting for publication ${publicationId}.`);
      }
      const publication =
        await this.getSoftwareChangePublication(publicationId);
      options?.onUpdate?.(publication);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(
          publication,
        )
      ) {
        return publication;
      }
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public createDevelopmentCampaign(input: {
    projectId: string;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: {
      commitMessage: string;
      pullRequest: { title: string; body: string; draft: false };
    };
    idempotencyKey: string;
  }) {
    return this.developmentCampaignRequest('/v1/development-campaigns', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        projectId: input.projectId,
        policyId: input.policyId,
        objective: input.objective,
        ticket: input.ticket,
        delivery: input.delivery,
      },
    });
  }

  public async listDevelopmentCampaignPolicies() {
    const value: unknown = await this.request(
      '/v1/development-campaign-policies',
    );
    assertDevelopmentCampaignPolicyListResource(value);
    return value;
  }

  public async listDevelopmentCampaigns() {
    const value: unknown = await this.request('/v1/development-campaigns');
    assertDevelopmentCampaignListResource(value);
    return value;
  }

  public getDevelopmentCampaign(campaignId: string) {
    return this.developmentCampaignRequest(
      `/v1/development-campaigns/${encodeURIComponent(campaignId)}`,
    );
  }

  public decideDevelopmentCampaign(input: {
    campaignId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.developmentCampaignRequest(
      `/v1/development-campaigns/${encodeURIComponent(input.campaignId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelDevelopmentCampaign(campaignId: string) {
    return this.developmentCampaignRequest(
      `/v1/development-campaigns/${encodeURIComponent(campaignId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public async listMissionPolicies() {
    const value: unknown = await this.request('/v1/mission-policies');
    assertMissionPolicyListResource(value);
    return value;
  }

  public async listMissions() {
    const value: unknown = await this.request('/v1/missions');
    assertMissionListResource(value);
    return value;
  }

  public async listRoutines() {
    const value: unknown = await this.request('/v1/routines');
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.routines)
    )
      throw new Error('Vera returned an invalid routine list.');
    for (const routine of value.routines) assertRoutineResource(routine);
    return value as { schemaVersion: 1; routines: RoutineResource[] };
  }

  public async createRoutine(input: {
    title: string;
    schedule: RoutineScheduleResource;
    action: RoutineResource['approval']['effect']['action'];
    idempotencyKey: string;
  }) {
    return this.routineRequest('/v1/routines', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        title: input.title,
        schedule: input.schedule,
        action: input.action,
      },
    });
  }

  public decideRoutine(input: {
    routineId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.routineRequest(
      `/v1/routines/${encodeURIComponent(input.routineId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public pauseRoutine(routineId: string) {
    return this.routineRequest(
      `/v1/routines/${encodeURIComponent(routineId)}/pause`,
      { method: 'POST' },
    );
  }

  public resumeRoutine(routineId: string) {
    return this.routineRequest(
      `/v1/routines/${encodeURIComponent(routineId)}/resume`,
      { method: 'POST' },
    );
  }

  public async runRoutineNow(input: {
    routineId: string;
    idempotencyKey: string;
  }) {
    const value: unknown = await this.request(
      `/v1/routines/${encodeURIComponent(input.routineId)}/runs`,
      { method: 'POST', idempotencyKey: input.idempotencyKey },
    );
    assertRoutineRunResource(value);
    return value;
  }

  public async listRoutineRuns(routineId: string) {
    const value: unknown = await this.request(
      `/v1/routines/${encodeURIComponent(routineId)}/runs`,
    );
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.runs)
    )
      throw new Error('Vera returned an invalid routine-run list.');
    for (const run of value.runs) assertRoutineRunResource(run);
    return value as { schemaVersion: 1; runs: RoutineRunResource[] };
  }

  public async getRoutineRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ) {
    const value: unknown = await this.request(
      `/v1/routine-runs/${encodeURIComponent(runId)}`,
      options?.signal === undefined ? undefined : { signal: options.signal },
    );
    assertRoutineRunResource(value);
    return value;
  }

  public async waitForRoutineRun(
    runId: string,
    options?: WaitForRoutineRunOptions,
  ): Promise<RoutineRunResource> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 120_000;
    const intervalMs = options?.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error('waitForRoutineRun timeoutMs must be a positive number.');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
      throw new Error(
        'waitForRoutineRun intervalMs must be a positive number.',
      );
    const terminal = new Set<RoutineRunResource['status']>([
      'succeeded',
      'failed',
      'cancelled',
    ]);
    for (;;) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs)
        throw new Error(`Timed out waiting for routine run ${runId}.`);
      const timeoutSignal = AbortSignal.timeout(
        Math.max(1, timeoutMs - elapsedMs),
      );
      const signal =
        options?.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      let run: RoutineRunResource;
      try {
        run = await this.getRoutineRun(runId, { signal });
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        if (timeoutSignal.aborted)
          throw new Error(`Timed out waiting for routine run ${runId}.`, {
            cause: error,
          });
        throw error;
      }
      options?.onUpdate?.(run);
      if ((options?.until ?? ((current) => terminal.has(current.status)))(run))
        return run;
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public createMission(input: {
    projectId: string;
    policyId: string;
    objective: string;
    completionCriteria: string;
    delivery: { commitMessage: string; pullRequestTitle: string };
    idempotencyKey: string;
  }) {
    return this.missionRequest('/v1/missions', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        action: 'create',
        projectId: input.projectId,
        policyId: input.policyId,
        objective: input.objective,
        completionCriteria: input.completionCriteria,
        delivery: input.delivery,
      },
    });
  }

  public getMission(missionId: string) {
    return this.missionRequest(`/v1/missions/${encodeURIComponent(missionId)}`);
  }

  public decideMission(input: {
    missionId: string;
    decision: 'approved' | 'rejected';
  }) {
    return this.missionRequest(
      `/v1/missions/${encodeURIComponent(input.missionId)}/decision`,
      { method: 'POST', body: { decision: input.decision } },
    );
  }

  public cancelMission(missionId: string) {
    return this.missionRequest(
      `/v1/missions/${encodeURIComponent(missionId)}/cancellation`,
      { method: 'POST' },
    );
  }

  public async waitForMission(
    missionId: string,
    options?: WaitForMissionOptions,
  ) {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 4 * 60 * 60_000;
    const intervalMs = options?.intervalMs ?? 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('waitForMission timeoutMs must be positive.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('waitForMission intervalMs must be positive.');
    }
    const terminal = new Set<MissionStatus>([
      'succeeded',
      'rejected',
      'review_required',
      'failed',
      'cancelled',
    ]);
    for (;;) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for mission ${missionId}.`);
      }
      const mission = await this.getMission(missionId);
      options?.onUpdate?.(mission);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(mission)
      )
        return mission;
      await delay(
        Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        options?.signal,
      );
    }
  }

  public async waitForDevelopmentCampaign(
    campaignId: string,
    options?: WaitForDevelopmentCampaignOptions,
  ) {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? 4 * 60 * 60_000;
    const intervalMs = options?.intervalMs ?? 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('waitForDevelopmentCampaign timeoutMs must be positive.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        'waitForDevelopmentCampaign intervalMs must be positive.',
      );
    }
    const terminal = new Set<DevelopmentCampaignStatus>([
      'succeeded',
      'rejected',
      'failed',
      'review_required',
      'cancelled',
    ]);
    for (;;) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for campaign ${campaignId}.`);
      }
      const campaign = await this.getDevelopmentCampaign(campaignId);
      options?.onUpdate?.(campaign);
      if (
        (options?.until ?? ((current) => terminal.has(current.status)))(
          campaign,
        )
      )
        return campaign;
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

  private async softwareChangePublicationRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<SoftwareChangePublicationResource> {
    const value: unknown = await this.request(path, options);
    assertSoftwareChangePublicationResource(value);
    return value;
  }

  private async developmentCampaignRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<DevelopmentCampaignResource> {
    const value: unknown = await this.request(path, options);
    assertDevelopmentCampaignResource(value);
    return value;
  }

  private async missionRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<MissionResource> {
    const value: unknown = await this.request(path, options);
    assertMissionResource(value);
    return value;
  }

  private async routineRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<RoutineResource> {
    const value: unknown = await this.request(path, options);
    assertRoutineResource(value);
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
      throw this.errorFromBody(response.status, body);
    }
    return body as T;
  }

  private async apiError(response: Response): Promise<VeraApiError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return this.errorFromBody(response.status, body);
  }

  private errorFromBody(status: number, body: unknown): VeraApiError {
    const error =
      isRecord(body) && isRecord(body.error) ? body.error : undefined;
    const code =
      error !== undefined && typeof error.code === 'string'
        ? error.code
        : 'request_failed';
    const message =
      error !== undefined && typeof error.message === 'string'
        ? error.message
        : `Vera request failed with HTTP ${String(status)}.`;
    return new VeraApiError(message, status, code, body);
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  idempotencyKey?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};
