import type { AttachmentReference, ArtifactReference } from './index.ts';

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
