export type ResourceErrorCode =
  | 'project_not_found'
  | 'conversation_not_found'
  | 'artifact_not_found'
  | 'personal_task_not_found'
  | 'reminder_not_found'
  | 'memory_not_found'
  | 'attachment_not_found'
  | 'knowledge_source_not_found'
  | 'knowledge_source_conflict'
  | 'invalid_knowledge_source'
  | 'invalid_knowledge_evidence'
  | 'knowledge_analysis_required'
  | 'knowledge_integrity_failure'
  | 'attention_item_not_found'
  | 'invalid_attention_decision'
  | 'invalid_notification_cursor'
  | 'idempotency_key_reused'
  | 'invalid_project_source'
  | 'notification_device_not_found'
  | 'push_notifications_disabled'
  | 'notification_project_mismatch'
  | 'notification_device_inactive'
  | 'invalid_notification_preferences'
  | 'concurrent_transition_failed';

export class ResourceError extends Error {
  public constructor(
    message: string,
    public readonly code: ResourceErrorCode,
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}
