import { z } from 'zod';

import {
  SpeechTranscriptionProviderError,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionProvider,
} from '../../../ports/transcription/speech-transcription-provider.ts';

const WhisperCppResponseSchema = z.looseObject({ text: z.string() });

export class WhisperCppSpeechTranscriptionProvider
  implements SpeechTranscriptionProvider
{
  public readonly name = 'whisper_cpp';
  public readonly model: string;
  public readonly dataBoundary = 'owner_controlled';
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      timeoutMs: number;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async transcribe(input: SpeechTranscriptionInput) {
    const form = new FormData();
    form.set('response_format', 'json');
    const bytes = new ArrayBuffer(input.audio.byteLength);
    new Uint8Array(bytes).set(input.audio);
    form.set(
      'file',
      new Blob([bytes], { type: input.contentType }),
      input.filename,
    );
    const startedAt = performance.now();
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
      response = await this.fetchImplementation(
        `${this.options.baseUrl}/inference`,
        {
          method: 'POST',
          body: form,
          signal:
            input.signal === undefined
              ? timeoutSignal
              : AbortSignal.any([input.signal, timeoutSignal]),
        },
      );
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new SpeechTranscriptionProviderError(
        timeout
          ? `whisper.cpp transcription timed out after ${String(this.options.timeoutMs)}ms`
          : 'whisper.cpp transcription could not be reached',
        timeout ? 'transcription_timeout' : 'transcription_unavailable',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new SpeechTranscriptionProviderError(
        `whisper.cpp transcription returned HTTP ${String(response.status)}`,
        response.status >= 400 && response.status < 500
          ? 'transcription_rejected'
          : 'transcription_unavailable',
      );
    }
    let candidate: unknown;
    try {
      candidate = await response.json();
    } catch (error) {
      throw new SpeechTranscriptionProviderError(
        'whisper.cpp transcription returned malformed JSON',
        'transcription_response_invalid',
        { cause: error },
      );
    }
    const parsed = WhisperCppResponseSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.text.trim().length === 0) {
      throw new SpeechTranscriptionProviderError(
        'whisper.cpp transcription response did not satisfy the adapter contract',
        'transcription_response_invalid',
      );
    }
    return {
      text: parsed.data.text,
      provider: this.name,
      model: this.model,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
