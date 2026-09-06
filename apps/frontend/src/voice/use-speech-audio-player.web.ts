import { useCallback, useEffect, useRef } from 'react';

import {
  prepareSpeechAudio,
  type PreparedSpeechAudio,
} from '@/voice/speech-audio-source';

type PendingPlayback = {
  audio: HTMLAudioElement;
  source: PreparedSpeechAudio;
  reject(error: Error): void;
};

export function useSpeechAudioPlayer() {
  const pending = useRef<PendingPlayback | undefined>(undefined);

  const stop = useCallback(() => {
    const current = pending.current;
    if (current === undefined) return;
    pending.current = undefined;
    current.audio.onended = null;
    current.audio.onerror = null;
    current.audio.pause();
    current.audio.removeAttribute('src');
    current.audio.load();
    current.source.release();
    current.reject(new Error('Speech playback was interrupted.'));
  }, []);

  const play = useCallback(
    (bytes: ArrayBuffer): Promise<void> => {
      stop();
      const source = prepareSpeechAudio(bytes);
      const audio = new Audio(source.uri);
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const release = () => {
          if (settled) return false;
          settled = true;
          if (pending.current?.audio === audio) pending.current = undefined;
          audio.onended = null;
          audio.onerror = null;
          audio.removeAttribute('src');
          audio.load();
          source.release();
          return true;
        };
        pending.current = { audio, source, reject };
        audio.onended = () => {
          if (release()) resolve();
        };
        audio.onerror = () => {
          if (release()) {
            reject(new Error('The browser could not play Vera speech audio.'));
          }
        };
        void audio.play().catch((error: unknown) => {
          if (release()) {
            reject(
              error instanceof Error
                ? error
                : new Error('The browser refused speech playback.'),
            );
          }
        });
      });
    },
    [stop],
  );

  useEffect(() => () => stop(), [stop]);
  return { play, stop };
}
