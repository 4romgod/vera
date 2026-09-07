import type {
  AttentionBriefing,
  AttentionItem,
  DevelopmentCampaignPolicyResource,
  DevelopmentCampaignResource,
  KnowledgeSearchResponse,
  KnowledgeSourceResource,
  MachineCatalogResource,
  MemoryResource,
  MissionResource,
  NotificationResource,
  PersonalTaskResource,
  ReminderResource,
  RoutineResource,
  RoutineRunResource,
  ProjectResource,
  IntegrationConnectionResource,
} from '@vera/client';

export type ResourceTab =
  | 'attention'
  | 'memory'
  | 'knowledge'
  | 'tasks'
  | 'reminders'
  | 'notifications'
  | 'machines'
  | 'routines'
  | 'missions'
  | 'campaigns';

export type ResourcePanelProps = {
  compact: boolean;
  open: boolean;
  tab: ResourceTab;
  width: number;
  minimumWidth: number;
  maximumWidth: number;
  attention?: AttentionBriefing;
  focusedAttentionItemId?: string;
  memories: MemoryResource[];
  knowledgeSources: KnowledgeSourceResource[];
  tasks: PersonalTaskResource[];
  reminders: ReminderResource[];
  notifications: NotificationResource[];
  machines: MachineCatalogResource['machines'];
  campaigns: DevelopmentCampaignResource[];
  campaignPolicies: DevelopmentCampaignPolicyResource[];
  missions: MissionResource[];
  routines: RoutineResource[];
  routineRuns: Partial<Record<string, RoutineRunResource[]>>;
  routineActionId?: string;
  projects: ProjectResource[];
  integrationConnections: IntegrationConnectionResource[];
  onTab: (tab: ResourceTab) => void;
  onAttentionDecision: (
    item: AttentionItem,
    decision: 'dismiss' | 'snooze' | 'restore',
  ) => Promise<boolean>;
  onOpenAttention: (item: AttentionItem) => void;
  onHandleAttention: (item: AttentionItem) => Promise<boolean>;
  onOpenNotification: (notification: NotificationResource) => void;
  onClose: () => void;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onMemoryCommand: (command: string) => void;
  onKnowledgeCommand: (command: string) => void;
  onSearchKnowledge: (query: string) => Promise<KnowledgeSearchResponse>;
  onRemoveKnowledge: (sourceId: string) => Promise<boolean>;
  onMachineCommand: (command: string) => void;
  onCreateCampaign: (input: {
    projectId: string;
    policyId: string;
    objective: string;
  }) => Promise<boolean>;
  onCampaignDecision: (
    campaignId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onCampaignCancel: (campaignId: string) => Promise<boolean>;
  onCampaignRepairRequest: (campaignId: string) => Promise<boolean>;
  onCampaignRepairDecision: (
    campaignId: string,
    repairId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onMissionDecision: (
    missionId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onMissionCancel: (missionId: string) => Promise<boolean>;
  onCreateRoutine: (input: {
    title: string;
    machineId: string;
    serviceIds?: string[];
    localTime: string;
    daysOfWeek: number[];
    timeZone: string;
  }) => Promise<boolean>;
  onCreateExternalWatch: (input: {
    title: string;
    projectId: string;
    minutes: number;
    categories: (
      | 'review_requested'
      | 'mentioned'
      | 'assigned'
      | 'failed_check'
    )[];
  }) => Promise<boolean>;
  onCreateSignalTriage: (input: {
    title: string;
    projectId: string;
    categories: (
      | 'review_requested'
      | 'mentioned'
      | 'assigned'
      | 'failed_check'
    )[];
    expiresAt: string;
    maxOccurrencesPerDay: number;
    maxTotalOccurrences: number;
  }) => Promise<boolean>;
  onRoutineDecision: (
    routineId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<boolean>;
  onPauseRoutine: (routineId: string) => Promise<boolean>;
  onResumeRoutine: (routineId: string) => Promise<boolean>;
  onRunRoutineNow: (
    routineId: string,
  ) => Promise<RoutineRunResource | undefined>;
};
