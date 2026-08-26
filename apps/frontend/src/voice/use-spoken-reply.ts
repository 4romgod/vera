import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';

import { splitSpeech } from '@/voice/split-speech';

export function useSpokenReply(options: {
  locale: string;
  onError: (message: string) => void;
}) {
  const [messageId, setMessageId] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);
  const onError = useRef(options.onError);
  onError.current = options.onError;

  const stop = useCallback(async () => {
    generation.current += 1;
    await Speech.stop();
    if (mounted.current) setMessageId(undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      void Speech.stop();
    };
  }, []);

  const speak = useCallback(
    async (nextMessageId: string, text: string) => {
      const chunks = splitSpeech(text);
      if (chunks.length === 0) return;

      const nextGeneration = generation.current + 1;
      generation.current = nextGeneration;
      await Speech.stop();
      if (generation.current !== nextGeneration || !mounted.current) return;
      setMessageId(nextMessageId);

      const speakChunk = (index: number) => {
        if (generation.current !== nextGeneration) return;
        if (index >= chunks.length) {
          if (mounted.current) setMessageId(undefined);
          return;
        }
        const chunk = chunks[index];
        Speech.speak(chunk, {
          language: options.locale,
          rate: 0.95,
          onDone: () => speakChunk(index + 1),
          onStopped: () => {
            if (generation.current === nextGeneration && mounted.current) {
              setMessageId(undefined);
            }
          },
          onError: () => {
            if (generation.current === nextGeneration && mounted.current) {
              setMessageId(undefined);
              onError.current('Vera could not play this reply aloud.');
            }
          },
        });
      };

      speakChunk(0);
    },
    [options.locale],
  );

  return { messageId, speak, stop };
}
