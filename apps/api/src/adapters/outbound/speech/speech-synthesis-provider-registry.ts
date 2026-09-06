import type { SpeechSynthesisProvider } from '../../../ports/speech/speech-synthesis-provider.ts';
import { DisabledSpeechSynthesisProvider } from './disabled-speech-synthesis-provider.ts';
import { PocketTtsSpeechSynthesisProvider } from './pocket-tts-speech-synthesis-provider.ts';

export type SpeechSynthesisConfig =
  | { provider: 'disabled'; maxTextCharacters: number }
  | {
      provider: 'pocket_tts';
      baseUrl: string;
      voice: string;
      timeoutMs: number;
      readinessTimeoutMs: number;
      maxAudioBytes: number;
      maxTextCharacters: number;
    };

export function createSpeechSynthesisProvider(
  config: SpeechSynthesisConfig,
): SpeechSynthesisProvider {
  switch (config.provider) {
    case 'disabled':
      return new DisabledSpeechSynthesisProvider();
    case 'pocket_tts':
      return new PocketTtsSpeechSynthesisProvider(config);
  }
}
