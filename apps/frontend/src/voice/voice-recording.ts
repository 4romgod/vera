export const MAX_VOICE_RECORDING_BYTES = 25_000_000;
export const VOICE_RECORDING_SAMPLE_RATE = 16_000;
export const VOICE_RECORDING_CHANNELS = 1;
export const VOICE_RECORDING_BIT_RATE = 64_000;

export function mergeVoiceTranscript(
  existingDraft: string,
  transcription: string,
): string {
  return [existingDraft.trim(), transcription.trim()]
    .filter((part) => part.length > 0)
    .join(' ');
}

export function voiceRecordingContentType(uri: string): string {
  if (process.env.EXPO_OS === 'web' || /\.webm(?:$|[?#])/iu.test(uri)) {
    return 'audio/webm';
  }
  if (/\.wav(?:$|[?#])/iu.test(uri)) return 'audio/wav';
  if (/\.mp3(?:$|[?#])/iu.test(uri)) return 'audio/mpeg';
  return 'audio/mp4';
}

export function formatVoiceDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
