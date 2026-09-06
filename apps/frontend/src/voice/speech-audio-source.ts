import { File, Paths } from 'expo-file-system';

export type PreparedSpeechAudio = {
  uri: string;
  release(): void;
};

export function prepareSpeechAudio(bytes: ArrayBuffer): PreparedSpeechAudio {
  const file = new File(
    Paths.cache,
    `vera-speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.wav`,
  );
  file.create({ overwrite: true, intermediates: true });
  file.write(new Uint8Array(bytes));
  return {
    uri: file.uri,
    release: () => {
      if (file.exists) file.delete();
    },
  };
}
