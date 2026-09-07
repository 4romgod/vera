import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

import {
  prepareSpeechAudio,
  type PreparedSpeechAudio,
} from '@/voice/speech-audio-source';

type PendingPlayback = {
  source: PreparedSpeechAudio;
  started: boolean;
  resolve(): void;
  reject(error: Error): void;
};

export function useSpeechAudioPlayer() {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const pending = useRef<PendingPlayback | undefined>(undefined);

  const settle = useCallback((error?: Error) => {
    const current = pending.current;
    if (current === undefined) return;
    pending.current = undefined;
    current.source.release();
    if (error === undefined) current.resolve();
    else current.reject(error);
  }, []);

  const stop = useCallback(() => {
    player.pause();
    settle(new Error('Speech playback was interrupted.'));
  }, [player, settle]);

  const play = useCallback(
    (bytes: ArrayBuffer): Promise<void> => {
      stop();
      const source = prepareSpeechAudio(bytes);
      return new Promise<void>((resolve, reject) => {
        pending.current = { source, started: false, resolve, reject };
        player.replace(source.uri);
      });
    },
    [player, stop],
  );

  useEffect(() => {
    const current = pending.current;
    if (current === undefined) return;
    if (status.error !== null) {
      settle(new Error(status.error));
      return;
    }
    if (status.didJustFinish) {
      settle();
      return;
    }
    if (status.isLoaded && !current.started) {
      current.started = true;
      player.play();
    }
  }, [player, settle, status.didJustFinish, status.error, status.isLoaded]);

  useEffect(() => () => stop(), [stop]);
  return { play, stop };
}
