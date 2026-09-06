import {
  SpeechSynthesisProviderError,
  type SpeechSynthesisProvider,
  type SynthesizedSpeech,
} from '../../ports/speech/speech-synthesis-provider.ts';

export const MaxSpeechTextCharacters = 20_000;

export type SpeechSynthesisService = {
  availability(): {
    schemaVersion: 1;
    enabled: boolean;
    provider?: string;
    model?: string;
    voice?: string;
    voices?: string[];
    dataBoundary?: 'owner_controlled' | 'third_party';
  };
  checkReadiness(): Promise<void>;
  synthesize(input: {
    text: string;
    voice?: string;
    signal?: AbortSignal;
  }): Promise<SynthesizedSpeech>;
};

export function createSpeechSynthesisService(options: {
  provider: SpeechSynthesisProvider;
}): SpeechSynthesisService {
  return {
    availability() {
      return options.provider.enabled
        ? {
            schemaVersion: 1,
            enabled: true,
            provider: options.provider.name,
            model: options.provider.model,
            voice: options.provider.voice,
            voices: [...options.provider.voices],
            dataBoundary: options.provider.dataBoundary,
          }
        : { schemaVersion: 1, enabled: false };
    },
    checkReadiness: () => options.provider.checkReadiness(),
    async synthesize(input) {
      const text = input.text.trim();
      if (!text) {
        throw new SpeechSynthesisProviderError(
          'Speech text must not be empty.',
          'speech_rejected',
        );
      }
      if (text.length > MaxSpeechTextCharacters) {
        throw new SpeechSynthesisProviderError(
          `Speech text exceeds Vera's ${String(MaxSpeechTextCharacters)} character limit.`,
          'speech_rejected',
        );
      }
      const voice = input.voice ?? options.provider.voice;
      if (!options.provider.voices.includes(voice)) {
        throw new SpeechSynthesisProviderError(
          'The requested speech voice is not available.',
          'speech_rejected',
        );
      }
      return options.provider.synthesize({
        text,
        voice,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    },
  };
}
