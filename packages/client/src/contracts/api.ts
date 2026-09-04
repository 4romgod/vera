import type {
  AttachmentResource,
  MachineCatalogResource,
  PersonalTaskResource,
  ReminderResource,
  MemoryResource,
  KnowledgeScope,
  KnowledgeSourceResource,
  KnowledgeSearchResponse,
  NotificationPage,
  NotificationStreamEvent,
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
  ChangeApplicationResource,
  ChangeApplicationEventsResource,
  ChangeApplicationListResource,
  SoftwareChangePublicationResource,
  SoftwareChangePublicationEventsResource,
  SoftwareChangePublicationListResource,
  DevelopmentCampaignResource,
  MissionResource,
  MissionListResource,
  MissionPolicyListResource,
  RoutineScheduleResource,
  RoutineResource,
  RoutineRunResource,
  DevelopmentCampaignListResource,
  DevelopmentCampaignPolicyListResource,
} from './index.ts';

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
