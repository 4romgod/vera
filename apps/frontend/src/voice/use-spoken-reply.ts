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
  const pending = useRef<
    | {
        generation: number;
        settle(outcome: 'played' | 'interrupted' | 'delivery_unknown'): void;
      }
    | undefined
  >(undefined);
  onError.current = options.onError;

  const stop = useCallback(async () => {
    generation.current += 1;
    pending.current?.settle('interrupted');
    pending.current = undefined;
    await Speech.stop();
    if (mounted.current) setMessageId(undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      pending.current?.settle('delivery_unknown');
      pending.current = undefined;
      void Speech.stop();
    };
  }, []);

  const speak = useCallback(
    async (
      nextMessageId: string,
      text: string,
    ): Promise<'played' | 'interrupted' | 'delivery_unknown'> => {
      const chunks = splitSpeech(text);
      if (chunks.length === 0) return 'played';

      const nextGeneration = generation.current + 1;
      generation.current = nextGeneration;
      pending.current?.settle('interrupted');
      pending.current = undefined;
      await Speech.stop();
      if (generation.current !== nextGeneration || !mounted.current)
        return 'interrupted';
      setMessageId(nextMessageId);
      return new Promise((resolve) => {
        let settled = false;
        const settle = (
          outcome: 'played' | 'interrupted' | 'delivery_unknown',
        ) => {
          if (settled) return;
          settled = true;
          if (pending.current?.generation === nextGeneration)
            pending.current = undefined;
          if (mounted.current) setMessageId(undefined);
          resolve(outcome);
        };
        pending.current = { generation: nextGeneration, settle };
        const speakChunk = (index: number) => {
          if (generation.current !== nextGeneration) {
            settle('interrupted');
            return;
          }
          if (index >= chunks.length) {
            settle('played');
            return;
          }
          Speech.speak(chunks[index], {
            language: options.locale,
            rate: 0.95,
            onDone: () => speakChunk(index + 1),
            onStopped: () => settle('interrupted'),
            onError: () => {
              onError.current('Vera could not play this reply aloud.');
              settle('delivery_unknown');
            },
          });
        };
        speakChunk(0);
      });
    },
    [options.locale],
  );

  return { messageId, speak, stop };
}
