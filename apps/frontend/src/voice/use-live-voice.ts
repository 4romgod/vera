import { useCallback, useEffect, useRef, useState } from 'react';

import type { TaskResource, VeraClient } from '@vera/client';

import {
  LiveVoiceConnection,
  type LiveVoiceConnectionState,
} from './live-voice-connection.ts';
import type { LiveVoiceEvent } from './live-voice-events.ts';

export type LiveVoicePhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'reconnecting'
  | 'stopping';

export function useLiveVoice(options: {
  client: VeraClient;
  speak: (
    messageId: string,
    text: string,
  ) => Promise<'played' | 'interrupted' | 'delivery_unknown'>;
  stopSpeaking: () => Promise<void>;
  onTurnSubmitted: (task: TaskResource) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [available, setAvailable] = useState<boolean>();
  const [phase, setPhase] = useState<LiveVoicePhase>('idle');
  const [transcript, setTranscript] = useState<string>();
  const connection = useRef<LiveVoiceConnection | undefined>(undefined);
  const sessionId = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const speakingDeliveryId = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    mounted.current = true;
    void options.client
      .getLiveVoiceAvailability()
      .then((result) => {
        if (mounted.current) setAvailable(result.enabled);
      })
      .catch(() => {
        if (mounted.current) setAvailable(false);
      });
    return () => {
      mounted.current = false;
      generation.current += 1;
      const id = sessionId.current;
      sessionId.current = undefined;
      void connection.current?.stop();
      connection.current = undefined;
      if (id !== undefined)
        void callbacks.current.client.endLiveVoiceSession(id);
    };
  }, [options.client]);

  const handleEvent = useCallback((event: LiveVoiceEvent) => {
    if (event.sessionId !== sessionId.current || !mounted.current) return;
    if (event.type === 'ready' || event.type === 'listening') {
      setPhase('listening');
    } else if (event.type === 'speech_started') {
      speakingDeliveryId.current = undefined;
      setPhase('hearing');
      void callbacks.current.stopSpeaking();
    } else if (event.type === 'transcript') {
      setTranscript(event.text);
      setPhase('thinking');
      callbacks.current.onTranscript(event.text);
    } else if (event.type === 'turn_submitted') {
      void callbacks.current.client
        .getRun(event.runId)
        .then((task) => callbacks.current.onTurnSubmitted(task))
        .catch(() => undefined);
    } else if (event.type === 'speech_delivery') {
      speakingDeliveryId.current = event.deliveryId;
      setPhase('speaking');
      void callbacks.current
        .speak(event.deliveryId, event.text)
        .then(async (outcome) => {
          if (sessionId.current !== event.sessionId) return;
          await callbacks.current.client.acknowledgeSpeechDelivery({
            sessionId: event.sessionId,
            deliveryId: event.deliveryId,
            outcome,
          });
          if (
            mounted.current &&
            speakingDeliveryId.current === event.deliveryId
          ) {
            speakingDeliveryId.current = undefined;
            setPhase('listening');
          }
        })
        .catch(() => {
          callbacks.current.onError(
            'Vera could not confirm spoken reply delivery.',
          );
        });
    } else if (event.type === 'error') {
      callbacks.current.onError(event.message);
      setPhase('listening');
    } else {
      speakingDeliveryId.current = undefined;
      sessionId.current = undefined;
      setPhase('idle');
      void callbacks.current.stopSpeaking();
      void connection.current?.stop();
      connection.current = undefined;
    }
  }, []);

  const handleConnectionState = useCallback(
    (state: LiveVoiceConnectionState) => {
      if (!mounted.current || sessionId.current === undefined) return;
      if (state === 'connecting') setPhase('connecting');
      else if (state === 'reconnecting') setPhase('reconnecting');
      else if (state === 'connected') return;
      else {
        const id = sessionId.current;
        generation.current += 1;
        speakingDeliveryId.current = undefined;
        sessionId.current = undefined;
        connection.current = undefined;
        setPhase('idle');
        void callbacks.current.stopSpeaking();
        void callbacks.current.client.endLiveVoiceSession(id);
        callbacks.current.onError(
          'The live voice connection ended. Start a new session to continue.',
        );
      }
    },
    [],
  );

  const start = useCallback(
    async (input: { conversationId: string; projectId?: string }) => {
      if (phase !== 'idle') return;
      const currentGeneration = generation.current + 1;
      generation.current = currentGeneration;
      setTranscript(undefined);
      setPhase('connecting');
      try {
        const created = await callbacks.current.client.createLiveVoiceSession({
          conversationId: input.conversationId,
          idempotencyKey: `live-voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          takeover: true,
          ...(input.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
        });
        if (generation.current !== currentGeneration || !mounted.current) {
          await callbacks.current.client
            .endLiveVoiceSession(created.session.id)
            .catch(() => undefined);
          return;
        }
        sessionId.current = created.session.id;
        const nextConnection = new LiveVoiceConnection({
          event: handleEvent,
          state: handleConnectionState,
        });
        connection.current = nextConnection;
        await nextConnection.connect(
          created.transport.url,
          created.transport.token,
        );
      } catch (error) {
        if (generation.current !== currentGeneration || !mounted.current)
          return;
        const id = sessionId.current;
        sessionId.current = undefined;
        connection.current = undefined;
        setPhase('idle');
        if (id !== undefined)
          void callbacks.current.client.endLiveVoiceSession(id);
        callbacks.current.onError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Vera could not start live conversation mode.',
        );
      }
    },
    [handleConnectionState, handleEvent, phase],
  );

  const stop = useCallback(async () => {
    const id = sessionId.current;
    if (phase === 'idle' || phase === 'stopping') return;
    generation.current += 1;
    speakingDeliveryId.current = undefined;
    setPhase('stopping');
    await callbacks.current.stopSpeaking();
    const activeConnection = connection.current;
    connection.current = undefined;
    await activeConnection?.stop().catch(() => undefined);
    try {
      if (id !== undefined)
        await callbacks.current.client.endLiveVoiceSession(id);
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error
          ? error.message
          : 'Vera could not end live conversation mode.',
      );
    } finally {
      sessionId.current = undefined;
      if (mounted.current) setPhase('idle');
    }
  }, [phase]);

  return {
    available,
    active: phase !== 'idle',
    phase,
    transcript,
    start,
    stop,
  };
}
