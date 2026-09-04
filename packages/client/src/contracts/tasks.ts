import type {
  RunStatus,
  CapabilityDestination,
  AttachmentReference,
  ConversationContextManifest,
  Approval,
  ArtifactReference,
  MachineDiagnosticContent,
  MachineServiceActionResultContent,
  PersonalTaskResultContent,
  PersonalReminderResultContent,
  MemoryResultContent,
  KnowledgeResultContent,
  MemoryContextManifest,
  AttentionResultContent,
  RoutineSummaryResource,
  RoutineRunResource,
  SoftwareDeliveryManagementResult,
} from './index.ts';

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
        kind: 'software_delivery_management_result';
        result?: SoftwareDeliveryManagementResult;
        artifact?: Extract<
          ArtifactReference,
          { type: 'software_delivery_management_result' }
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
