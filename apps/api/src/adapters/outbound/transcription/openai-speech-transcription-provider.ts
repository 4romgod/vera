import { z } from 'zod';

import {
  SpeechTranscriptionProviderError,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionProvider,
} from '../../../ports/transcription/speech-transcription-provider.ts';

const OpenAiTranscriptionSchema = z.looseObject({
  text: z.string(),
});

export type OpenAiSpeechTranscriptionProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
};

function errorCode(status: number) {
  return status >= 400 && status < 500
    ? ('transcription_rejected' as const)
    : ('transcription_unavailable' as const);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export class OpenAiSpeechTranscriptionProvider
  implements SpeechTranscriptionProvider
{
  public readonly name = 'openai';
  public readonly dataBoundary = 'third_party';
  public readonly model: string;

  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(
    private readonly options: OpenAiSpeechTranscriptionProviderOptions,
  ) {
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async transcribe(input: SpeechTranscriptionInput) {
    const form = new FormData();
    form.set('model', this.model);
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
        `${this.options.baseUrl}/audio/transcriptions`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}` },
          body: form,
          signal:
            input.signal === undefined
              ? timeoutSignal
              : AbortSignal.any([input.signal, timeoutSignal]),
        },
      );
    } catch (error) {
      throw new SpeechTranscriptionProviderError(
        isTimeout(error)
          ? `OpenAI transcription timed out after ${String(this.options.timeoutMs)}ms`
          : 'OpenAI transcription could not be reached',
        isTimeout(error)
          ? 'transcription_timeout'
          : 'transcription_unavailable',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new SpeechTranscriptionProviderError(
        `OpenAI transcription returned HTTP ${String(response.status)}`,
        errorCode(response.status),
      );
    }
    let candidate: unknown;
    try {
      candidate = await response.json();
    } catch (error) {
      throw new SpeechTranscriptionProviderError(
        'OpenAI transcription returned malformed JSON',
        'transcription_response_invalid',
        { cause: error },
      );
    }
    const parsed = OpenAiTranscriptionSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.text.trim().length === 0) {
      throw new SpeechTranscriptionProviderError(
        'OpenAI transcription response did not satisfy the adapter contract',
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
