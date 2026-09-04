import type {
  CapabilityDestination,
  Approval,
  MachineDiagnosticContent,
  SoftwareChangeContent,
} from './index.ts';

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
  | 'repair_awaiting_approval'
  | 'repairing'
  | 'merging'
  | 'synchronizing'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'review_required'
  | 'cancelled';

export type PullRequestObservationResource = {
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
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE';
  mergeState: string;
  failedChecks?: {
    name: string;
    status: string;
    conclusion: string;
    detailsUrl?: string;
    summary?: string;
  }[];
  reviewFeedback?: {
    kind: 'review' | 'comment' | 'inline_comment';
    author: string;
    body: string;
    url?: string;
    path?: string;
    line?: number;
  }[];
};

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
    kind?: 'initial' | 'local_replacement' | 'pull_request_repair';
    sourceRevision?: string;
    repairId?: string;
    requestedChange?: {
      objective: string;
      ticket: { reference: string; details: string };
    };
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
  repairs?: {
    schemaVersion: 1;
    id: string;
    requestKey: string;
    status: 'pending' | 'approved' | 'rejected' | 'applied';
    reason: 'pull_request_repair';
    effect: {
      attempt: number;
      sourceRevision: string;
      pullRequest: { number: number; url: string };
      requestedChange: {
        objective: string;
        ticket: { reference: string; details: string };
      };
      delivery: {
        commitMessage: string;
        author: { name: string; email: string };
      };
      authority: {
        context: 'exact_pull_request_head';
        application: 'exact_generated_patch';
        verification: 'configured_commands';
        push: 'fast_forward_existing_pull_request_branch';
        forcePush: false;
        merge: false;
      };
    };
    evidence: PullRequestObservationResource;
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
    appliedAt?: string;
    result?: { headRevision: string; previousRevision: string };
  }[];
  publicationId?: string;
  pullRequest?: {
    number: number;
    url: string;
    headRevision: string;
    observation?: PullRequestObservationResource;
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
