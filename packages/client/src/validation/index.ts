import type {
  AttachmentResource,
  AttachmentReference,
  MachineCatalogResource,
  PersonalTaskResource,
  NotificationResource,
  ReminderResource,
  MemoryResource,
  KnowledgeSourceResource,
  KnowledgeSearchResponse,
  PushPreferences,
  NotificationDeviceResource,
  PushDeliveryResource,
  PushNotificationStatus,
  AttentionBriefing,
  SpeechTranscriptionResource,
  TaskResource,
  CapabilityCatalogResource,
  ChangeApplicationResource,
  ChangeApplicationListResource,
  SoftwareChangePublicationResource,
  SoftwareChangePublicationListResource,
  DevelopmentCampaignResource,
  MissionResource,
  MissionListResource,
  MissionPolicyListResource,
  RoutineResource,
  RoutineRunResource,
  DevelopmentCampaignListResource,
  DevelopmentCampaignPolicyListResource,
} from '../contracts/index.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertTaskResource(
  value: unknown,
): asserts value is TaskResource {
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

export function assertAttachmentResource(
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

export function assertCapabilityCatalogResource(
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

export function assertMachineCatalogResource(
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

export function assertSpeechTranscriptionResource(
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

export function assertPersonalTaskResource(
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

export function assertNotificationResource(
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

export function assertReminderResource(
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

export function assertMemoryResource(
  value: unknown,
): asserts value is MemoryResource {
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

export function isAttachmentReference(
  value: unknown,
): value is AttachmentReference {
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

export function assertKnowledgeSourceResource(
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

export function assertKnowledgeSearchResponse(
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

export function isMemoryScope(
  value: unknown,
): value is MemoryResource['scope'] {
  return (
    isRecord(value) &&
    (value.kind === 'global' ||
      (value.kind === 'project' &&
        typeof value.projectId === 'string' &&
        value.projectId.startsWith('project_')))
  );
}

export function isMemoryProvenance(
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

export function isMemoryHistoryEntry(
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

export function assertChangeApplicationResource(
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

export function assertChangeApplicationListResource(
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

export function assertSoftwareChangePublicationResource(
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

export function assertSoftwareChangePublicationListResource(
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

export function assertDevelopmentCampaignResource(
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
    'repair_awaiting_approval',
    'repairing',
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

export function assertDevelopmentCampaignListResource(
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

export function assertDevelopmentCampaignPolicyListResource(
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

export function assertMissionResource(
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

export function assertMissionListResource(
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

export function assertMissionPolicyListResource(
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

export function assertRoutineResource(
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

export function assertRoutineRunResource(
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

export function assertAttentionBriefing(
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

export function isAttentionTarget(value: Record<string, unknown>): boolean {
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

export function assertPushNotificationStatus(
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

export function isPushPreferences(value: unknown): value is PushPreferences {
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

export function assertNotificationDeviceResource(
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

export function assertPushDeliveryResource(
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
