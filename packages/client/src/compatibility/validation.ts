import { z } from 'zod';

import type {
  AttachmentResource,
  AttentionBriefing,
  CapabilityCatalogResource,
  ChangeApplicationListResource,
  ChangeApplicationResource,
  DevelopmentCampaignListResource,
  DevelopmentCampaignPolicyListResource,
  DevelopmentCampaignResource,
  KnowledgeSearchResponse,
  KnowledgeSourceResource,
  MachineCatalogResource,
  MemoryResource,
  MissionListResource,
  MissionPolicyListResource,
  MissionResource,
  NotificationDeviceResource,
  PersonalTaskResource,
  PushDeliveryResource,
  PushNotificationStatus,
  ReminderResource,
  RoutineResource,
  RoutineRunResource,
  SoftwareChangePublicationListResource,
  SoftwareChangePublicationResource,
  SpeechTranscriptionResource,
  TaskResource,
} from '../generated/types.gen.ts';
import {
  zAttachmentResource,
  zAttentionBriefing,
  zAttentionBriefingItemsItemsTarget,
  zCapabilityCatalogResource,
  zChangeApplicationListResource,
  zChangeApplicationResource,
  zDevelopmentCampaignListResource,
  zDevelopmentCampaignPolicyListResource,
  zDevelopmentCampaignResource,
  zKnowledgeSearchResponse,
  zKnowledgeSourceResource,
  zMachineCatalogResource,
  zMemoryResource,
  zMemoryResourceHistoryItems,
  zMemoryResourceProvenance,
  zMemoryResourceScope,
  zMissionListResource,
  zMissionPolicyListResource,
  zMissionResource,
  zNotificationDeviceResource,
  zNotificationDeviceResourcePreferences,
  zPersonalTaskResource,
  zPushDeliveryResource,
  zPushNotificationStatus,
  zReminderResource,
  zReminderResourceNotification,
  zRoutineResource,
  zRoutineRunResource,
  zSoftwareChangePublicationListResource,
  zSoftwareChangePublicationResource,
  zSpeechTranscriptionResource,
  zTaskResource,
  zTaskResourceAttachmentsItems,
  zMissionResourceNotification,
} from '../generated/zod.gen.ts';
import type {
  AttachmentReference,
  NotificationResource,
  PushPreferences,
} from '../sdk-types.ts';

type Parser = { parse(value: unknown): unknown };

const notificationResourceSchema = z.union([
  zReminderResourceNotification,
  zMissionResourceNotification,
]);

function assertGenerated(
  schema: Parser,
  value: unknown,
  message: string,
): void {
  try {
    schema.parse(value);
  } catch (cause) {
    throw new Error(message, { cause });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertTaskResource(
  value: unknown,
): asserts value is TaskResource {
  assertGenerated(
    zTaskResource,
    value,
    'Vera returned an invalid task resource.',
  );
}

export function assertAttachmentResource(
  value: unknown,
): asserts value is AttachmentResource {
  assertGenerated(
    zAttachmentResource,
    value,
    'Vera returned an invalid attachment resource.',
  );
}

export function assertCapabilityCatalogResource(
  value: unknown,
): asserts value is CapabilityCatalogResource {
  assertGenerated(
    zCapabilityCatalogResource,
    value,
    'Vera returned an invalid capability catalog.',
  );
}

export function assertMachineCatalogResource(
  value: unknown,
): asserts value is MachineCatalogResource {
  assertGenerated(
    zMachineCatalogResource,
    value,
    'Vera returned an invalid machine catalog.',
  );
}

export function assertSpeechTranscriptionResource(
  value: unknown,
): asserts value is SpeechTranscriptionResource {
  assertGenerated(
    zSpeechTranscriptionResource,
    value,
    'Vera returned an invalid speech transcription.',
  );
}

export function assertPersonalTaskResource(
  value: unknown,
): asserts value is PersonalTaskResource {
  assertGenerated(
    zPersonalTaskResource,
    value,
    'Vera returned an invalid personal task resource.',
  );
}

export function assertNotificationResource(
  value: unknown,
): asserts value is NotificationResource {
  assertGenerated(
    notificationResourceSchema,
    value,
    'Vera returned an invalid notification resource.',
  );
}

export function assertReminderResource(
  value: unknown,
): asserts value is ReminderResource {
  assertGenerated(
    zReminderResource,
    value,
    'Vera returned an invalid reminder resource.',
  );
}

export function assertMemoryResource(
  value: unknown,
): asserts value is MemoryResource {
  assertGenerated(
    zMemoryResource,
    value,
    'Vera returned an invalid memory resource.',
  );
}

export function isAttachmentReference(
  value: unknown,
): value is AttachmentReference {
  return zTaskResourceAttachmentsItems.safeParse(value).success;
}

export function assertKnowledgeSourceResource(
  value: unknown,
): asserts value is KnowledgeSourceResource {
  assertGenerated(
    zKnowledgeSourceResource,
    value,
    'Vera returned an invalid knowledge source.',
  );
}

export function assertKnowledgeSearchResponse(
  value: unknown,
): asserts value is KnowledgeSearchResponse {
  assertGenerated(
    zKnowledgeSearchResponse,
    value,
    'Vera returned invalid knowledge search results.',
  );
}

export function isMemoryScope(
  value: unknown,
): value is MemoryResource['scope'] {
  return zMemoryResourceScope.safeParse(value).success;
}

export function isMemoryProvenance(
  value: unknown,
): value is MemoryResource['provenance'] {
  return zMemoryResourceProvenance.safeParse(value).success;
}

export function isMemoryHistoryEntry(
  value: unknown,
): value is MemoryResource['history'][number] {
  return zMemoryResourceHistoryItems.safeParse(value).success;
}

export function assertChangeApplicationResource(
  value: unknown,
): asserts value is ChangeApplicationResource {
  assertGenerated(
    zChangeApplicationResource,
    value,
    'Vera returned an invalid change-application resource.',
  );
}

export function assertChangeApplicationListResource(
  value: unknown,
): asserts value is ChangeApplicationListResource {
  assertGenerated(
    zChangeApplicationListResource,
    value,
    'Vera returned an invalid change-application list.',
  );
}

export function assertSoftwareChangePublicationResource(
  value: unknown,
): asserts value is SoftwareChangePublicationResource {
  assertGenerated(
    zSoftwareChangePublicationResource,
    value,
    'Vera returned an invalid software-change publication resource.',
  );
}

export function assertSoftwareChangePublicationListResource(
  value: unknown,
): asserts value is SoftwareChangePublicationListResource {
  assertGenerated(
    zSoftwareChangePublicationListResource,
    value,
    'Vera returned an invalid software-publication list.',
  );
}

export function assertDevelopmentCampaignResource(
  value: unknown,
): asserts value is DevelopmentCampaignResource {
  assertGenerated(
    zDevelopmentCampaignResource,
    value,
    'Vera returned an invalid development-campaign resource.',
  );
}

export function assertDevelopmentCampaignListResource(
  value: unknown,
): asserts value is DevelopmentCampaignListResource {
  assertGenerated(
    zDevelopmentCampaignListResource,
    value,
    'Vera returned an invalid development-campaign list.',
  );
}

export function assertDevelopmentCampaignPolicyListResource(
  value: unknown,
): asserts value is DevelopmentCampaignPolicyListResource {
  assertGenerated(
    zDevelopmentCampaignPolicyListResource,
    value,
    'Vera returned an invalid development-campaign policy list.',
  );
}

export function assertMissionResource(
  value: unknown,
): asserts value is MissionResource {
  assertGenerated(
    zMissionResource,
    value,
    'Vera returned an invalid mission resource.',
  );
}

export function assertMissionListResource(
  value: unknown,
): asserts value is MissionListResource {
  assertGenerated(
    zMissionListResource,
    value,
    'Vera returned an invalid mission list.',
  );
}

export function assertMissionPolicyListResource(
  value: unknown,
): asserts value is MissionPolicyListResource {
  assertGenerated(
    zMissionPolicyListResource,
    value,
    'Vera returned an invalid mission policy list.',
  );
}

export function assertRoutineResource(
  value: unknown,
): asserts value is RoutineResource {
  assertGenerated(
    zRoutineResource,
    value,
    'Vera returned an invalid routine resource.',
  );
}

export function assertRoutineRunResource(
  value: unknown,
): asserts value is RoutineRunResource {
  assertGenerated(
    zRoutineRunResource,
    value,
    'Vera returned an invalid routine-run resource.',
  );
}

export function assertAttentionBriefing(
  value: unknown,
): asserts value is AttentionBriefing {
  assertGenerated(
    zAttentionBriefing,
    value,
    'Vera returned an invalid attention briefing.',
  );
}

export function isAttentionTarget(value: Record<string, unknown>): boolean {
  return zAttentionBriefingItemsItemsTarget.safeParse(value).success;
}

export function assertPushNotificationStatus(
  value: unknown,
): asserts value is PushNotificationStatus {
  assertGenerated(
    zPushNotificationStatus,
    value,
    'Vera returned invalid push-notification status.',
  );
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
  return zNotificationDeviceResourcePreferences.safeParse(value).success;
}

export function assertNotificationDeviceResource(
  value: unknown,
): asserts value is NotificationDeviceResource {
  assertGenerated(
    zNotificationDeviceResource,
    value,
    'Vera returned an invalid notification device.',
  );
}

export function assertPushDeliveryResource(
  value: unknown,
): asserts value is PushDeliveryResource {
  assertGenerated(
    zPushDeliveryResource,
    value,
    'Vera returned an invalid push delivery.',
  );
}
