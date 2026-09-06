import {
  type SpeechSynthesisAudio,
  type SpeechSynthesisAvailability,
  type VeraClient,
} from '@vera/client';

export type SpeechSynthesisClient = {
  availability(): Promise<SpeechSynthesisAvailability>;
  synthesize(input: {
    text: string;
    voice?: string;
    signal?: AbortSignal;
  }): Promise<SpeechSynthesisAudio>;
};

export function createSpeechSynthesisClient(
  client: VeraClient,
): SpeechSynthesisClient {
  return {
    availability: () => client.getSpeechSynthesisAvailability(),
    synthesize: (input) => client.synthesizeSpeech(input),
  };
}
