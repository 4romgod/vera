import { z } from 'zod';

import {
  SpeechSynthesisProviderError,
  type SpeechSynthesisInput,
  type SpeechSynthesisProvider,
} from '../../../ports/speech/speech-synthesis-provider.ts';

const ReadyResponseSchema = z
  .object({
    status: z.literal('ready'),
    service: z.literal('vera-pocket-tts'),
    model: z.string().min(1).max(200),
    voices: z
      .array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u))
      .min(1)
      .max(64)
      .refine((voices) => new Set(voices).size === voices.length, {
        message: 'Voice identifiers must be unique.',
      }),
  })
  .strict();

const WaveHeaderBytes = 12;

function isWave(bytes: Uint8Array): boolean {
  if (bytes.byteLength < WaveHeaderBytes) return false;
  return (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE'
  );
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 1 || size > maximumBytes) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS declared an invalid audio response size',
        'speech_response_invalid',
      );
    }
  }
  if (response.body === null) {
    throw new SpeechSynthesisProviderError(
      'Pocket TTS returned no audio body',
      'speech_response_invalid',
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const candidate: unknown = await reader.read();
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !('done' in candidate) ||
      typeof candidate.done !== 'boolean'
    ) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS returned an invalid audio stream',
        'speech_response_invalid',
      );
    }
    if (candidate.done) break;
    if (!('value' in candidate) || !(candidate.value instanceof Uint8Array)) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS returned an invalid audio chunk',
        'speech_response_invalid',
      );
    }
    const value = candidate.value;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new SpeechSynthesisProviderError(
        'Pocket TTS returned more audio than Vera can safely accept',
        'speech_response_invalid',
      );
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export class PocketTtsSpeechSynthesisProvider
  implements SpeechSynthesisProvider
{
  public readonly name = 'pocket_tts';
  public readonly model = 'pocket-tts-3.1.0';
  public readonly voice: string;
  public readonly dataBoundary = 'owner_controlled';
  public readonly enabled = true;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private availableVoices: readonly string[];

  public get voices(): readonly string[] {
    return this.availableVoices;
  }

  public constructor(
    private readonly options: {
      baseUrl: string;
      voice: string;
      timeoutMs: number;
      readinessTimeoutMs: number;
      maxAudioBytes: number;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    this.voice = options.voice;
    this.availableVoices = [options.voice];
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async checkReadiness(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.options.baseUrl}/ready`,
        {
          signal: AbortSignal.timeout(this.options.readinessTimeoutMs),
        },
      );
    } catch (error) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS readiness could not be reached',
        'speech_unavailable',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new SpeechSynthesisProviderError(
        `Pocket TTS readiness returned HTTP ${String(response.status)}`,
        'speech_unavailable',
      );
    }
    let candidate: unknown;
    try {
      candidate = await response.json();
    } catch (error) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS readiness returned malformed JSON',
        'speech_response_invalid',
        { cause: error },
      );
    }
    const parsed = ReadyResponseSchema.safeParse(candidate);
    if (!parsed.success || !parsed.data.voices.includes(this.voice)) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS readiness did not satisfy the configured adapter contract',
        'speech_response_invalid',
      );
    }
    this.availableVoices = Object.freeze([...parsed.data.voices].sort());
  }

  public async synthesize(input: SpeechSynthesisInput) {
    const voice = input.voice ?? this.voice;
    if (!this.availableVoices.includes(voice)) {
      throw new SpeechSynthesisProviderError(
        'The requested Pocket TTS voice is not available',
        'speech_rejected',
      );
    }
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.options.baseUrl}/v1/speech`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            text: input.text,
            voiceId: voice,
          }),
          signal: requestSignal(input.signal, this.options.timeoutMs),
        },
      );
    } catch (error) {
      throw new SpeechSynthesisProviderError(
        isTimeout(error)
          ? `Pocket TTS synthesis timed out after ${String(this.options.timeoutMs)}ms`
          : 'Pocket TTS synthesis could not be reached',
        isTimeout(error) ? 'speech_timeout' : 'speech_unavailable',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new SpeechSynthesisProviderError(
        `Pocket TTS synthesis returned HTTP ${String(response.status)}`,
        response.status >= 400 && response.status < 500
          ? 'speech_rejected'
          : 'speech_unavailable',
      );
    }
    if (
      response.headers.get('content-type')?.split(';', 1)[0] !== 'audio/wav'
    ) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS returned an unsupported audio type',
        'speech_response_invalid',
      );
    }
    const audio = await readBoundedBytes(response, this.options.maxAudioBytes);
    if (!isWave(audio)) {
      throw new SpeechSynthesisProviderError(
        'Pocket TTS returned invalid WAV audio',
        'speech_response_invalid',
      );
    }
    return {
      audio,
      contentType: 'audio/wav' as const,
      provider: this.name,
      model: this.model,
      voice,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
