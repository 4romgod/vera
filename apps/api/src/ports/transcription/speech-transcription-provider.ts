export type SpeechTranscriptionInput = {
  audio: Uint8Array;
  contentType: string;
  filename: string;
  signal?: AbortSignal;
};

export type SpeechTranscriptionResult = {
  text: string;
  provider: string;
  model: string;
  durationMs: number;
};

export type SpeechTranscriptionProvider = {
  readonly name: string;
  readonly model: string;
  readonly dataBoundary: 'owner_controlled' | 'third_party';
  transcribe(
    input: SpeechTranscriptionInput,
  ): Promise<SpeechTranscriptionResult>;
};

export type SpeechTranscriptionErrorCode =
  | 'transcription_not_configured'
  | 'transcription_rejected'
  | 'transcription_response_invalid'
  | 'transcription_timeout'
  | 'transcription_unavailable';

export class SpeechTranscriptionProviderError extends Error {
  public constructor(
    message: string,
    public readonly code: SpeechTranscriptionErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SpeechTranscriptionProviderError';
  }
}
