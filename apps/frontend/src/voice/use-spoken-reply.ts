import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import type { SpeechSynthesisAvailability } from '@vera/client';

import { splitSpeech } from '@/voice/split-speech';
import type { VoiceSettingsController } from '@/voice/settings/contracts';
import {
  isVoiceAvailable,
  resolveDeviceVoice,
  resolveNeuralVoice,
  type DeviceVoice,
} from '@/voice/settings/voice-preferences';
import { useVoicePreferences } from '@/voice/settings/use-voice-preferences';
import { useSpeechAudioPlayer } from '@/voice/use-speech-audio-player';
import type { SpeechSynthesisClient } from '@/voice/speech-synthesis-client';

const VOICE_DISCOVERY_TIMEOUT_MS = 3_000;
const PREVIEW_TEXT =
  'Hi, I’m Vera. This is how I’ll sound when I read replies aloud.';

export function useSpokenReply(options: {
  locale: string;
  onError: (message: string) => void;
  speechSynthesis: SpeechSynthesisClient;
}) {
  const [messageId, setMessageId] = useState<string>();
  const [voices, setVoices] = useState<DeviceVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [previewing, setPreviewing] =
    useState<VoiceSettingsController['previewing']>();
  const [synthesis, setSynthesis] = useState<
    SpeechSynthesisAvailability | undefined
  >();
  const [loadingSynthesis, setLoadingSynthesis] = useState(true);
  const [synthesisUnavailable, setSynthesisUnavailable] = useState(false);
  const voicePreferences = useVoicePreferences();
  const audioPlayer = useSpeechAudioPlayer();
  const synthesisAbort = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const voiceDiscoveryGeneration = useRef(0);
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

  const refreshSynthesis = useCallback(async () => {
    if (mounted.current) setLoadingSynthesis(true);
    try {
      const availability = await options.speechSynthesis.availability();
      if (mounted.current) {
        setSynthesis(availability);
        setSynthesisUnavailable(false);
      }
    } catch {
      if (mounted.current) {
        setSynthesis(undefined);
        setSynthesisUnavailable(true);
      }
    } finally {
      if (mounted.current) setLoadingSynthesis(false);
    }
  }, [options.speechSynthesis]);

  const effectiveVoice = useMemo(
    () =>
      resolveDeviceVoice(
        voices,
        options.locale,
        voicePreferences.preferences.voiceId,
      ),
    [options.locale, voicePreferences.preferences.voiceId, voices],
  );

  const neuralVoices = synthesis?.voices ?? [];
  const effectiveNeuralVoice = resolveNeuralVoice(
    neuralVoices,
    synthesis?.voice,
    voicePreferences.preferences.neuralVoiceId,
  );

  const refreshVoices = useCallback(async () => {
    const nextGeneration = voiceDiscoveryGeneration.current + 1;
    voiceDiscoveryGeneration.current = nextGeneration;
    if (mounted.current) setLoadingVoices(true);
    const discovery = Speech.getAvailableVoicesAsync().catch(() => []);
    const timeout = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), VOICE_DISCOVERY_TIMEOUT_MS);
    });
    const discovered = await Promise.race([discovery, timeout]);
    if (
      discovered !== undefined &&
      mounted.current &&
      voiceDiscoveryGeneration.current === nextGeneration
    ) {
      setVoices(discovered);
      setLoadingVoices(false);
      return;
    }
    if (mounted.current && voiceDiscoveryGeneration.current === nextGeneration)
      setLoadingVoices(false);
    void discovery.then((lateVoices) => {
      if (
        mounted.current &&
        voiceDiscoveryGeneration.current === nextGeneration
      ) {
        setVoices(lateVoices);
      }
    });
  }, []);

  const stop = useCallback(async () => {
    generation.current += 1;
    synthesisAbort.current?.abort();
    synthesisAbort.current = undefined;
    audioPlayer.stop();
    pending.current?.settle('interrupted');
    pending.current = undefined;
    await Speech.stop();
    if (mounted.current) {
      setMessageId(undefined);
      setPreviewing(undefined);
    }
  }, [audioPlayer.stop]);

  useEffect(() => {
    mounted.current = true;
    void refreshVoices();
    void refreshSynthesis();
    return () => {
      mounted.current = false;
      generation.current += 1;
      voiceDiscoveryGeneration.current += 1;
      pending.current?.settle('delivery_unknown');
      pending.current = undefined;
      synthesisAbort.current?.abort();
      audioPlayer.stop();
      void Speech.stop();
    };
  }, [audioPlayer.stop, refreshSynthesis, refreshVoices]);

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
      setPreviewing(undefined);
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
        if (synthesis?.enabled === true) {
          const controller = new AbortController();
          synthesisAbort.current = controller;
          void (async () => {
            try {
              for (const chunk of chunks) {
                if (generation.current !== nextGeneration)
                  throw new DOMException('Interrupted', 'AbortError');
                const audio = await options.speechSynthesis.synthesize({
                  text: chunk,
                  ...(effectiveNeuralVoice === undefined
                    ? {}
                    : { voice: effectiveNeuralVoice }),
                  signal: controller.signal,
                });
                await audioPlayer.play(audio.bytes);
              }
              if (generation.current === nextGeneration) settle('played');
              else settle('interrupted');
            } catch {
              if (
                controller.signal.aborted ||
                generation.current !== nextGeneration
              ) {
                settle('interrupted');
              } else {
                onError.current('Vera could not play this reply aloud.');
                settle('delivery_unknown');
              }
            } finally {
              if (synthesisAbort.current === controller)
                synthesisAbort.current = undefined;
            }
          })();
          return;
        }
        if (loadingSynthesis || synthesisUnavailable) {
          onError.current(
            loadingSynthesis
              ? 'Vera is still checking the neural speech service.'
              : 'Vera’s neural speech service is unavailable.',
          );
          settle('delivery_unknown');
          return;
        }
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
            language: effectiveVoice?.language ?? options.locale,
            rate: voicePreferences.preferences.rate,
            pitch: voicePreferences.preferences.pitch,
            ...(effectiveVoice === undefined
              ? {}
              : { voice: effectiveVoice.identifier }),
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
    [
      effectiveVoice,
      effectiveNeuralVoice,
      audioPlayer.play,
      loadingSynthesis,
      options.locale,
      options.speechSynthesis,
      synthesis?.enabled,
      synthesisUnavailable,
      voicePreferences.preferences.pitch,
      voicePreferences.preferences.rate,
    ],
  );

  const previewNeural = useCallback(
    async (voiceId?: string) => {
      const nextGeneration = generation.current + 1;
      generation.current = nextGeneration;
      synthesisAbort.current?.abort();
      synthesisAbort.current = undefined;
      audioPlayer.stop();
      pending.current?.settle('interrupted');
      pending.current = undefined;
      await Speech.stop();
      if (generation.current !== nextGeneration || !mounted.current) return;
      setMessageId(undefined);
      const selectedVoice = voiceId ?? effectiveNeuralVoice;
      if (synthesis?.enabled !== true || selectedVoice === undefined) {
        onError.current('Vera’s neural speech service is unavailable.');
        return;
      }
      setPreviewing({ kind: 'neural', voiceId: selectedVoice });
      const controller = new AbortController();
      synthesisAbort.current = controller;
      try {
        const audio = await options.speechSynthesis.synthesize({
          text: PREVIEW_TEXT,
          voice: selectedVoice,
          signal: controller.signal,
        });
        if (generation.current !== nextGeneration) return;
        await audioPlayer.play(audio.bytes);
      } catch {
        if (
          !controller.signal.aborted &&
          generation.current === nextGeneration
        ) {
          onError.current('Vera could not preview this neural voice.');
        }
      } finally {
        if (synthesisAbort.current === controller)
          synthesisAbort.current = undefined;
        if (generation.current === nextGeneration) setPreviewing(undefined);
      }
    },
    [
      audioPlayer.play,
      audioPlayer.stop,
      effectiveNeuralVoice,
      options.speechSynthesis,
      synthesis?.enabled,
    ],
  );

  const previewFallback = useCallback(
    async (voiceId?: string) => {
      const nextGeneration = generation.current + 1;
      generation.current = nextGeneration;
      synthesisAbort.current?.abort();
      synthesisAbort.current = undefined;
      audioPlayer.stop();
      pending.current?.settle('interrupted');
      pending.current = undefined;
      await Speech.stop();
      if (generation.current !== nextGeneration || !mounted.current) return;
      const previewVoice =
        voiceId === undefined
          ? effectiveVoice
          : voices.find((voice) => voice.identifier === voiceId);
      if (voiceId !== undefined && previewVoice === undefined) {
        onError.current('That fallback voice is no longer available.');
        return;
      }
      setMessageId(undefined);
      setPreviewing({
        kind: 'fallback',
        voiceId: voiceId ?? null,
      });
      Speech.speak(PREVIEW_TEXT, {
        language: previewVoice?.language ?? options.locale,
        rate: voicePreferences.preferences.rate,
        pitch: voicePreferences.preferences.pitch,
        ...(previewVoice === undefined
          ? {}
          : { voice: previewVoice.identifier }),
        onDone: () => {
          if (mounted.current && generation.current === nextGeneration)
            setPreviewing(undefined);
        },
        onStopped: () => {
          if (mounted.current && generation.current === nextGeneration)
            setPreviewing(undefined);
        },
        onError: () => {
          if (mounted.current && generation.current === nextGeneration) {
            setPreviewing(undefined);
            onError.current('Vera could not preview this fallback voice.');
          }
        },
      });
    },
    [
      audioPlayer.stop,
      effectiveVoice,
      options.locale,
      voicePreferences.preferences.pitch,
      voicePreferences.preferences.rate,
      voices,
    ],
  );

  const updateVoiceSettings = useCallback(
    (changes: Parameters<typeof voicePreferences.update>[0]) => {
      void stop();
      voicePreferences.update(changes);
    },
    [stop, voicePreferences.update],
  );

  const resetVoiceSettings = useCallback(() => {
    void stop();
    voicePreferences.reset();
  }, [stop, voicePreferences.reset]);

  const voiceSettings: VoiceSettingsController = {
    synthesis: {
      loading: loadingSynthesis,
      enabled: synthesis?.enabled ?? false,
      ...(synthesis?.provider === undefined
        ? {}
        : { provider: synthesis.provider }),
      ...(synthesis?.model === undefined ? {} : { model: synthesis.model }),
      ...(synthesis?.voice === undefined ? {} : { voice: synthesis.voice }),
      voices: neuralVoices,
      unavailable: synthesisUnavailable,
      ...(synthesis?.dataBoundary === undefined
        ? {}
        : { dataBoundary: synthesis.dataBoundary }),
    },
    locale: options.locale,
    preferences: voicePreferences.preferences,
    voices,
    loadingVoices,
    effectiveVoice,
    effectiveNeuralVoice,
    selectedNeuralVoiceAvailable:
      voicePreferences.preferences.neuralVoiceId === undefined ||
      neuralVoices.includes(voicePreferences.preferences.neuralVoiceId),
    selectedFallbackVoiceAvailable: isVoiceAvailable(
      voices,
      voicePreferences.preferences.voiceId,
    ),
    previewing,
    refreshVoices,
    refreshSynthesis,
    previewNeural,
    previewFallback,
    stopPreview: stop,
    update: updateVoiceSettings,
    reset: resetVoiceSettings,
  };

  return { messageId, speak, stop, voiceSettings };
}
