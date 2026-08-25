export type ResourceErrorCode =
  | 'project_not_found'
  | 'conversation_not_found'
  | 'artifact_not_found'
  | 'idempotency_key_reused'
  | 'invalid_project_source';

export class ResourceError extends Error {
  public constructor(
    message: string,
    public readonly code: ResourceErrorCode,
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}
