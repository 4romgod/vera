export type LiveVoiceSessionErrorCode =
  | 'live_voice_disabled'
  | 'voice_session_active'
  | 'voice_session_not_found'
  | 'voice_session_not_recoverable'
  | 'voice_delivery_not_found'
  | 'voice_delivery_already_settled'
  | 'idempotency_key_reused'
  | 'concurrent_transition_failed';

export class LiveVoiceSessionError extends Error {
  public constructor(
    message: string,
    public readonly code: LiveVoiceSessionErrorCode,
  ) {
    super(message);
    this.name = 'LiveVoiceSessionError';
  }
}
