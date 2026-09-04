import type {
  CapabilityDestination,
  AttachmentReference,
  Approval,
  ArtifactReference,
  MachineDiagnosticContent,
  MachineServiceActionResultContent,
  PersonalTaskResultContent,
  PersonalReminderResultContent,
  MemoryResultContent,
  KnowledgeResultContent,
  AttentionResultContent,
  SoftwareChangeContent,
  ResearchReportContent,
  AttachmentAnalysisContent,
  RoutineSummaryResource,
  RoutineRunResource,
  SoftwareDeliveryManagementResult,
} from './index.ts';

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
    | {
        type: 'software_delivery_management_result';
        mediaType: 'application/vnd.vera.software-delivery-management-result+json';
        content: SoftwareDeliveryManagementResult;
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
