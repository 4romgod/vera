export type SpeechSynthesisInput = {
  text: string;
  voice?: string;
  signal?: AbortSignal;
};

export type SynthesizedSpeech = {
  audio: Uint8Array;
  contentType: 'audio/wav';
  provider: string;
  model: string;
  voice: string;
  durationMs: number;
};

export type SpeechSynthesisProvider = {
  readonly name: string;
  readonly model: string;
  readonly voice: string;
  readonly voices: readonly string[];
  readonly dataBoundary: 'owner_controlled' | 'third_party';
  readonly enabled: boolean;
  checkReadiness(): Promise<void>;
  synthesize(input: SpeechSynthesisInput): Promise<SynthesizedSpeech>;
};

export type SpeechSynthesisErrorCode =
  | 'speech_not_configured'
  | 'speech_rejected'
  | 'speech_response_invalid'
  | 'speech_timeout'
  | 'speech_unavailable';

export class SpeechSynthesisProviderError extends Error {
  public constructor(
    message: string,
    public readonly code: SpeechSynthesisErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SpeechSynthesisProviderError';
  }
}
