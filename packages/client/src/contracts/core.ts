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
      | 'software_delivery_metadata'
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
      | 'campaign_repair_draft_write'
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
    | {
        type: 'software_delivery_management_result';
        mediaType: 'application/vnd.vera.software-delivery-management-result+json';
      }
  );
