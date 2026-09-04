import type { Artifact } from '../../domain/artifacts/artifact.ts';
import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type {
  CapabilityAuthority,
  CapabilityDefinition,
  CapabilityReference,
} from '../../domain/capabilities/capability-registry.ts';
import type { ProjectContextBundle } from '../../domain/projects/project-context.ts';
import type { AttachmentReference } from '../../domain/attachments/attachment.ts';

export type CapabilityArtifactDraft =
  | Pick<
      Extract<Artifact, { type: 'implementation_plan' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'software_change' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'research_report' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'personal_task_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'personal_reminder_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'memory_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'attachment_analysis' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'machine_diagnostic' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'machine_service_action_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'mission_management_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'knowledge_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'attention_result' }>,
      'type' | 'mediaType' | 'content'
    >
  | Pick<
      Extract<Artifact, { type: 'routine_management_result' }>,
      'type' | 'mediaType' | 'content'
    >;

export type CapabilityRuntime = {
  readonly definition: CapabilityDefinition;
  readonly destination: CapabilityDestination;
  destinationFor?(arguments_: Record<string, unknown>): CapabilityDestination;
  readonly authority: CapabilityAuthority;
  authorityFor(input: {
    arguments: Record<string, unknown>;
    hasInputArtifacts: boolean;
    hasDecisionEvidence: boolean;
  }): CapabilityAuthority;
  checkReadiness(): Promise<void>;
  execute(
    invocation: {
      invocationId: string;
      principalId: string;
      startedAt: string;
      recovery: boolean;
      arguments: Record<string, unknown>;
      source?: {
        taskId: string;
        conversationId?: string;
        messageId?: string;
      };
      project?: { id: string; displayName: string };
      context?: ProjectContextBundle;
      artifacts?: Artifact[];
      attachments?: AttachmentReference[];
      limits: {
        maxDurationMs: number;
        maxArtifactBytes: number;
        maxChangedFiles: number;
        maxWebSearchCalls: number;
      };
    },
    options?: { signal?: AbortSignal },
  ): Promise<{
    artifact: CapabilityArtifactDraft;
    model: {
      provider: string;
      model: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    };
  }>;
};

export type CapabilityRuntimeRegistration = {
  definition: CapabilityDefinition;
  catalog?: {
    authority: CapabilityAuthority;
    destination?: CapabilityDestination;
  };
  selected(): CapabilityRuntime | null;
  resolve(destination: CapabilityDestination): CapabilityRuntime | null;
};

export type CapabilityRuntimeRegistry = {
  declarations(): {
    definition: CapabilityDefinition;
    authority: CapabilityAuthority;
    enabled: boolean;
    destination?: CapabilityDestination;
  }[];
  enabledReferences(): CapabilityReference[];
  selected(reference: CapabilityReference): CapabilityRuntime | null;
  resolve(
    reference: CapabilityReference,
    destination: CapabilityDestination,
  ): CapabilityRuntime | null;
};
