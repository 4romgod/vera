import type {
  SpeechTranscriptionProvider,
  SpeechTranscriptionResult,
} from '../../ports/transcription/speech-transcription-provider.ts';
import { SpeechTranscriptionProviderError } from '../../ports/transcription/speech-transcription-provider.ts';

const MaxTranscriptCharacters = 100_000;

const SupportedAudioTypes = new Map([
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
]);

export type TranscriptionService = {
  readonly provider: SpeechTranscriptionProvider;
  readonly maxAudioBytes: number;
  transcribe(input: {
    audio: Uint8Array;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<SpeechTranscriptionResult>;
};

export type TranscriptionRequestErrorCode =
  | 'audio_empty'
  | 'audio_too_large'
  | 'audio_type_unsupported';

export class TranscriptionRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: TranscriptionRequestErrorCode,
  ) {
    super(message);
    this.name = 'TranscriptionRequestError';
  }
}

function normalizedContentType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function createTranscriptionService(options: {
  provider: SpeechTranscriptionProvider;
  maxAudioBytes: number;
}): TranscriptionService {
  return {
    provider: options.provider,
    maxAudioBytes: options.maxAudioBytes,
    async transcribe(input) {
      if (input.audio.byteLength === 0) {
        throw new TranscriptionRequestError(
          'The audio recording is empty.',
          'audio_empty',
        );
      }
      if (input.audio.byteLength > options.maxAudioBytes) {
        throw new TranscriptionRequestError(
          `The audio recording exceeds Vera's ${String(options.maxAudioBytes)} byte limit.`,
          'audio_too_large',
        );
      }
      const contentType = normalizedContentType(input.contentType);
      const extension = SupportedAudioTypes.get(contentType);
      if (extension === undefined) {
        throw new TranscriptionRequestError(
          `Audio type "${contentType || 'unknown'}" is not supported.`,
          'audio_type_unsupported',
        );
      }

      const result = await options.provider.transcribe({
        audio: input.audio,
        contentType,
        filename: `recording.${extension}`,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      const text = result.text.trim();
      if (text.length === 0) {
        throw new TranscriptionRequestError(
          'No speech was detected in the recording.',
          'audio_empty',
        );
      }
      if (text.length > MaxTranscriptCharacters) {
        throw new SpeechTranscriptionProviderError(
          'The transcription provider returned more text than Vera can safely accept.',
          'transcription_response_invalid',
        );
      }
      return { ...result, text };
    },
  };
}
