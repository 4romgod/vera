import type { SpeechTranscriptionProvider } from '../../../ports/transcription/speech-transcription-provider.ts';
import { DisabledSpeechTranscriptionProvider } from './disabled-speech-transcription-provider.ts';
import { OpenAiSpeechTranscriptionProvider } from './openai-speech-transcription-provider.ts';
import { WhisperCppSpeechTranscriptionProvider } from './whisper-cpp-speech-transcription-provider.ts';

export type SpeechTranscriptionConfig =
  | { provider: 'disabled'; maxAudioBytes: number }
  | {
      provider: 'openai';
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs: number;
      maxAudioBytes: number;
    }
  | {
      provider: 'whisper_cpp';
      baseUrl: string;
      model: string;
      timeoutMs: number;
      maxAudioBytes: number;
    };

export function createSpeechTranscriptionProvider(
  config: SpeechTranscriptionConfig,
): SpeechTranscriptionProvider {
  switch (config.provider) {
    case 'disabled':
      return new DisabledSpeechTranscriptionProvider();
    case 'openai':
      return new OpenAiSpeechTranscriptionProvider(config);
    case 'whisper_cpp':
      return new WhisperCppSpeechTranscriptionProvider(config);
  }
}
