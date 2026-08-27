import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import {
  MAX_VOICE_RECORDING_BYTES,
  mergeVoiceTranscript,
  VOICE_RECORDING_BIT_RATE,
  VOICE_RECORDING_CHANNELS,
  VOICE_RECORDING_SAMPLE_RATE,
  voiceRecordingContentType,
} from '@/voice/voice-recording';

const VoiceRecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: VOICE_RECORDING_SAMPLE_RATE,
  numberOfChannels: VOICE_RECORDING_CHANNELS,
  bitRate: VOICE_RECORDING_BIT_RATE,
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: VOICE_RECORDING_BIT_RATE,
  },
};

export type VoiceInputPhase =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'transcribing';

export type VoiceStopAction = 'review' | 'submit';

export type VoiceInput = {
  phase: VoiceInputPhase;
  durationMs: number;
  start: (existingDraft: string) => Promise<void>;
  stop: (action: VoiceStopAction) => void;
  abort: () => void;
};

function permissionFailureMessage(canAskAgain: boolean): string {
  return canAskAgain
    ? 'Microphone permission is required for voice input.'
    : 'Voice input is blocked. Allow microphone access for Vera in device settings.';
}

function voiceFailureMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return 'Vera could not process that recording. Please try again.';
}

export function useVoiceInput(options: {
  transcribe: (input: {
    audio: Blob | ArrayBuffer;
    contentType: string;
    signal: AbortSignal;
  }) => Promise<string>;
  onFinish: (transcript: string, action: VoiceStopAction) => void;
  onError: (message: string) => void;
}): VoiceInput {
  const recorder = useAudioRecorder(VoiceRecordingOptions);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const phaseRef = useRef<VoiceInputPhase>('idle');
  const draftPrefix = useRef('');
  const session = useRef(0);
  const recording = useRef(false);
  const stopInFlight = useRef(false);
  const transcriptionAbort = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const transcribe = useRef(options.transcribe);
  const onFinish = useRef(options.onFinish);
  const onError = useRef(options.onError);

  transcribe.current = options.transcribe;
  onFinish.current = options.onFinish;
  onError.current = options.onError;

  const sessionIsActive = useCallback(
    (candidate: number) => mounted.current && session.current === candidate,
    [],
  );

  const transition = useCallback((next: VoiceInputPhase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);

  const abort = useCallback(() => {
    session.current += 1;
    transcriptionAbort.current?.abort();
    transcriptionAbort.current = undefined;
    stopInFlight.current = false;
    if (recording.current) {
      recording.current = false;
      void recorder.stop().catch(() => undefined);
    }
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    transition('idle');
  }, [recorder, transition]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current += 1;
      transcriptionAbort.current?.abort();
      if (recording.current) {
        recording.current = false;
        void recorder.stop().catch(() => undefined);
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    };
  }, [recorder]);

  const start = useCallback(
    async (existingDraft: string) => {
      if (phaseRef.current !== 'idle' || stopInFlight.current) return;
      const currentSession = session.current + 1;
      session.current = currentSession;
      draftPrefix.current = existingDraft;
      transition('requesting_permission');
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!sessionIsActive(currentSession)) return;
        if (!permission.granted) {
          throw new Error(permissionFailureMessage(permission.canAskAgain));
        }
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
        });
        if (!sessionIsActive(currentSession)) {
          await setAudioModeAsync({ allowsRecording: false });
          return;
        }
        await recorder.prepareToRecordAsync();
        if (!sessionIsActive(currentSession)) {
          await setAudioModeAsync({ allowsRecording: false });
          return;
        }
        recorder.record();
        recording.current = true;
        transition('recording');
      } catch (cause) {
        if (!sessionIsActive(currentSession)) return;
        recording.current = false;
        await setAudioModeAsync({ allowsRecording: false }).catch(
          () => undefined,
        );
        transition('idle');
        onError.current(voiceFailureMessage(cause));
      }
    },
    [recorder, sessionIsActive, transition],
  );

  const stop = useCallback(
    (action: VoiceStopAction) => {
      if (phaseRef.current !== 'recording' || stopInFlight.current) return;
      stopInFlight.current = true;
      recording.current = false;
      const currentSession = session.current;
      transition('transcribing');
      void (async () => {
        try {
          await recorder.stop();
          await setAudioModeAsync({ allowsRecording: false });
          if (!sessionIsActive(currentSession)) return;
          const uri = recorder.uri;
          if (uri === null) {
            throw new Error('The device did not produce an audio recording.');
          }
          const audio =
            process.env.EXPO_OS === 'web'
              ? await readWebRecording(uri)
              : await readNativeRecording(uri);
          const audioBytes =
            audio instanceof ArrayBuffer ? audio.byteLength : audio.size;
          if (audioBytes === 0) {
            throw new Error('The recording was empty. Please try again.');
          }
          if (audioBytes > MAX_VOICE_RECORDING_BYTES) {
            throw new Error(
              'That recording is too large to transcribe. Please send a shorter recording.',
            );
          }
          const controller = new AbortController();
          transcriptionAbort.current = controller;
          const text = await transcribe.current({
            audio,
            contentType: voiceRecordingContentType(uri),
            signal: controller.signal,
          });
          if (!sessionIsActive(currentSession)) return;
          onFinish.current(
            mergeVoiceTranscript(draftPrefix.current, text),
            action,
          );
        } catch (cause) {
          if (!sessionIsActive(currentSession)) return;
          onError.current(voiceFailureMessage(cause));
        } finally {
          if (session.current === currentSession) {
            transcriptionAbort.current = undefined;
            stopInFlight.current = false;
            transition('idle');
          }
        }
      })();
    },
    [recorder, sessionIsActive, transition],
  );

  return {
    phase,
    durationMs: phase === 'recording' ? recorderState.durationMillis : 0,
    start,
    stop,
    abort,
  };
}

async function readWebRecording(uri: string): Promise<Blob> {
  const response = await expoFetch(uri);
  if (!response.ok) {
    throw new Error('Vera could not read the completed recording.');
  }
  return response.blob();
}

async function readNativeRecording(uri: string): Promise<ArrayBuffer> {
  const file = new File(uri);
  if (!file.exists) {
    throw new Error('Vera could not find the completed recording.');
  }
  return file.arrayBuffer();
}
