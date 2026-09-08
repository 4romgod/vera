import { createAudioPlayer, type AudioStatus } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

import { prepareSpeechAudio } from '@/voice/speech-audio-source';
import {
  startSingleUseSpeechPlayback,
  type SingleUseSpeechPlayback,
} from '@/voice/single-use-speech-playback';

export function useSpeechAudioPlayer() {
  const pending = useRef<SingleUseSpeechPlayback | undefined>(undefined);

  const stop = useCallback(() => {
    pending.current?.interrupt();
    pending.current = undefined;
  }, []);

  const play = useCallback(
    (bytes: ArrayBuffer): Promise<void> => {
      stop();
      const source = prepareSpeechAudio(bytes);
      const playback = startSingleUseSpeechPlayback({
        source,
        createPlayer: () => {
          const player = createAudioPlayer(null, { updateInterval: 100 });
          const eventPlayer = player as typeof player & {
            addListener(
              event: 'playbackStatusUpdate',
              listener: (status: AudioStatus) => void,
            ): { remove(): void };
          };
          return {
            addStatusListener: (listener) =>
              eventPlayer.addListener('playbackStatusUpdate', listener),
            pause: () => player.pause(),
            play: () => player.play(),
            release: () => player.remove(),
            replace: (uri) => player.replace(uri),
          };
        },
      });
      pending.current = playback;
      return playback.promise.finally(() => {
        if (pending.current === playback) pending.current = undefined;
      });
    },
    [stop],
  );

  useEffect(() => () => stop(), [stop]);
  return { play, stop };
}
