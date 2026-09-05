import type {
  ArtifactResourceOneOfAttachmentAnalysisContent,
  ArtifactResourceOneOfAttentionResultContent,
  ArtifactResourceOneOfKnowledgeResultContent,
  ArtifactResourceOneOfMachineServiceActionResultContent,
  ArtifactResourceOneOfMemoryResultContent,
  ArtifactResourceOneOfPersonalReminderResultContent,
  ArtifactResourceOneOfPersonalTaskResultContent,
  ArtifactResourceOneOfResearchReportContent,
  ArtifactResourceOneOfRoutineManagementResultContentRoutine,
  ArtifactResourceOneOfSoftwareChangeContent,
  ArtifactResourceOneOfSoftwareDeliveryManagementResultContent,
  AttentionBriefing,
  CapabilityCatalogResource,
  ChangeApplicationResource,
  ConversationListResource,
  ConversationResource,
  DevelopmentCampaignPolicyListResource,
  DevelopmentCampaignResource,
  KnowledgeSearchResponse,
  MemoryResource,
  MissionPolicyListResource,
  MissionResource,
  NotificationPage,
  ReminderResource,
  RoutineResource,
  RoutineRunResource,
  RoutineRunResourceResultDiagnostic,
  SoftwareChangePublicationResource,
  TaskResource,
  TaskResourceAttachmentsItems,
  TaskResourceInvocationAnyOfWebResearchContextManifest,
  TaskResourceOutputOneOfGoalResultArtifactsItems,
  TaskResourceResultDiagnosticServicesItemsObservation,
  TaskResourceResultOneOfListResourcesItemsOneOfDevelopmentCampaign,
  TaskResourceResultOneOfListResourcesItemsOneOfMission,
  PutV1NotificationDevicesIdPreferencesRequest,
  IntegrationCatalogResource,
} from './generated/types.gen.ts';

export type RunStatus = TaskResource['runStatus'];
export type IntegrationDefinitionResource =
  IntegrationCatalogResource['integrations'][number];
export type CapabilityDestination = NonNullable<
  CapabilityCatalogResource['capabilities'][number]['destination']
>;
export type AttachmentReference = TaskResourceAttachmentsItems;
export type ArtifactReference = TaskResourceOutputOneOfGoalResultArtifactsItems;
export type ContextManifest =
  TaskResourceInvocationAnyOfWebResearchContextManifest;
export type ConversationContextManifest = NonNullable<
  TaskResource['conversationContextManifest']
>;
export type MemoryContextManifest = NonNullable<
  TaskResource['memoryContextManifest']
>;
export type Approval = NonNullable<TaskResource['approval']>;
export type ConversationMessageResource =
  ConversationResource['messages'][number];
export type ConversationSummaryResource =
  ConversationListResource['conversations'][number];

export type MachineObservation =
  TaskResourceResultDiagnosticServicesItemsObservation;
export type MachineDiagnosticContent = RoutineRunResourceResultDiagnostic;
export type MachineServiceActionResultContent =
  ArtifactResourceOneOfMachineServiceActionResultContent;
export type PersonalTaskResultContent =
  ArtifactResourceOneOfPersonalTaskResultContent;
export type PersonalReminderResultContent =
  ArtifactResourceOneOfPersonalReminderResultContent;
export type MemoryResultContent = ArtifactResourceOneOfMemoryResultContent;
export type KnowledgeResultContent =
  ArtifactResourceOneOfKnowledgeResultContent;
export type AttentionResultContent =
  ArtifactResourceOneOfAttentionResultContent;
export type SoftwareChangeContent = ArtifactResourceOneOfSoftwareChangeContent;
export type ResearchReportContent = ArtifactResourceOneOfResearchReportContent;
export type AttachmentAnalysisContent =
  ArtifactResourceOneOfAttachmentAnalysisContent;

export type ReminderNotificationResource = NonNullable<
  ReminderResource['notification']
>;
export type MissionNotificationResource = NonNullable<
  MissionResource['notification']
>;
export type NotificationResource = NotificationPage['notifications'][number];
export type NotificationStreamEvent = {
  cursor: string;
  notification: NotificationResource;
};

export type KnowledgeScope = MemoryResource['scope'];
export type KnowledgeSearchCitation =
  KnowledgeSearchResponse['citations'][number];
export type PushPreferences = PutV1NotificationDevicesIdPreferencesRequest;
export type AttentionItem = AttentionBriefing['items'][number];
export type AttentionPriority = AttentionItem['priority'];
export type AttentionState = AttentionItem['state'];
export type AttentionTarget = AttentionItem['target'];

export type ChangeApplicationStatus = ChangeApplicationResource['status'];
export type SoftwareChangePublicationStatus =
  SoftwareChangePublicationResource['status'];
export type DevelopmentCampaignStatus = DevelopmentCampaignResource['status'];
export type PullRequestObservationResource = NonNullable<
  DevelopmentCampaignResource['pullRequest']
>;
export type MissionStatus = MissionResource['status'];
export type MissionPolicyResource =
  MissionPolicyListResource['policies'][number];
export type RoutineScheduleResource =
  RoutineResource['approval']['effect']['schedule'];
export type RoutineSummaryResource =
  ArtifactResourceOneOfRoutineManagementResultContentRoutine;
export type DevelopmentCampaignPolicyResource =
  DevelopmentCampaignPolicyListResource['policies'][number];
export type SoftwareDeliveryMissionSummary =
  TaskResourceResultOneOfListResourcesItemsOneOfMission;
export type SoftwareDeliveryCampaignSummary =
  TaskResourceResultOneOfListResourcesItemsOneOfDevelopmentCampaign;
export type SoftwareDeliveryResourceSummary =
  | SoftwareDeliveryMissionSummary
  | SoftwareDeliveryCampaignSummary;
export type SoftwareDeliveryManagementResult =
  ArtifactResourceOneOfSoftwareDeliveryManagementResultContent;

export type SpeechTranscriptionAudio = Blob | ArrayBuffer;

export type WaitForRoutineRunOptions = WaitOptions<RoutineRunResource>;
export type WaitForRunOptions = WaitOptions<TaskResource>;
export type WaitForChangeApplicationOptions =
  WaitOptions<ChangeApplicationResource>;
export type WaitForSoftwareChangePublicationOptions =
  WaitOptions<SoftwareChangePublicationResource>;
export type WaitForDevelopmentCampaignOptions =
  WaitOptions<DevelopmentCampaignResource>;
export type WaitForMissionOptions = WaitOptions<MissionResource>;

type WaitOptions<T> = {
  until?: (resource: T) => boolean;
  onUpdate?: (resource: T) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};
