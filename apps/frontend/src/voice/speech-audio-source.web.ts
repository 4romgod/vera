import type { PreparedSpeechAudio } from './speech-audio-source.ts';

export function prepareSpeechAudio(bytes: ArrayBuffer): PreparedSpeechAudio {
  const uri = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  return { uri, release: () => URL.revokeObjectURL(uri) };
}
