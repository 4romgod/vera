import { useCallback, useEffect, useRef, useState } from 'react';

type RecognitionModule =
  (typeof import('expo-speech-recognition'))['ExpoSpeechRecognitionModule'];

type EventSubscription = { remove: () => void };

type PermissionDecision = {
  granted: boolean;
  canAskAgain: boolean;
};

export type VoiceInputPhase =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'finishing';

export type VoiceInput = {
  phase: VoiceInputPhase;
  start: (existingDraft: string) => Promise<void>;
  stop: () => void;
  abort: () => void;
};

function recognitionFailureMessage(): string {
  return process.env.EXPO_OS === 'web'
    ? 'Speech recognition is unavailable in this browser. You can keep typing to Vera.'
    : 'Voice input requires a Vera development build with speech recognition installed. You can keep typing to Vera.';
}

function permissionFailureMessage(canAskAgain: boolean): string {
  return canAskAgain
    ? 'Microphone and speech-recognition permission are required for voice input.'
    : 'Voice input is blocked. Allow microphone and speech recognition for Vera in device settings.';
}

function normalizePermissionDecision(value: unknown): PermissionDecision {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Voice input returned an invalid permission response.');
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.granted !== 'boolean' ||
    typeof candidate.canAskAgain !== 'boolean'
  ) {
    throw new Error('Voice input returned an invalid permission response.');
  }

  return {
    granted: candidate.granted,
    canAskAgain: candidate.canAskAgain,
  };
}

function recognitionEventFailureMessage(input: {
  error: string;
  message: string;
}): string {
  switch (input.error) {
    case 'no-speech':
    case 'speech-timeout':
      return 'No speech was detected. Try again when you are ready.';
    case 'not-allowed':
      return 'Microphone or speech-recognition permission was not granted. Allow it in browser or device settings, then try again.';
    case 'service-not-allowed':
      return recognitionFailureMessage();
    case 'language-not-supported':
      return 'The configured speech language is unavailable on this device.';
    case 'network':
      return 'The device speech service could not connect. Check its network access and try again.';
    case 'audio-capture':
      return 'The device could not start its microphone. Check whether another app is using it.';
    default:
      return `Voice input failed: ${input.message || input.error}.`;
  }
}

export function useVoiceInput(options: {
  locale: string;
  onTranscript: (transcript: string) => void;
  onError: (message: string) => void;
}): VoiceInput {
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const module = useRef<RecognitionModule | undefined>(undefined);
  const subscriptions = useRef<EventSubscription[]>([]);
  const draftPrefix = useRef('');
  const aborting = useRef(false);
  const session = useRef(0);
  const mounted = useRef(true);
  const onTranscript = useRef(options.onTranscript);
  const onError = useRef(options.onError);

  onTranscript.current = options.onTranscript;
  onError.current = options.onError;

  const removeListeners = useCallback(() => {
    for (const subscription of subscriptions.current) subscription.remove();
    subscriptions.current = [];
  }, []);

  const sessionIsActive = useCallback(
    (candidate: number) => mounted.current && session.current === candidate,
    [],
  );

  const abort = useCallback(() => {
    session.current += 1;
    aborting.current = true;
    module.current?.abort();
    removeListeners();
    if (mounted.current) setPhase('idle');
  }, [removeListeners]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current += 1;
      aborting.current = true;
      removeListeners();
      module.current?.abort();
    };
  }, [removeListeners]);

  const start = useCallback(
    async (existingDraft: string) => {
      if (phase !== 'idle') return;
      const currentSession = session.current + 1;
      session.current = currentSession;
      setPhase('requesting_permission');
      aborting.current = false;
      draftPrefix.current = existingDraft.trim();
      removeListeners();

      try {
        const speechRecognition = await import('expo-speech-recognition');
        if (!sessionIsActive(currentSession)) return;
        const recognition = speechRecognition.ExpoSpeechRecognitionModule;
        module.current = recognition;
        if (!recognition.isRecognitionAvailable()) {
          throw new Error(recognitionFailureMessage());
        }

        const permissionResponse: unknown =
          await recognition.requestPermissionsAsync();
        if (!sessionIsActive(currentSession)) return;
        const permission = normalizePermissionDecision(permissionResponse);
        if (!permission.granted) {
          throw new Error(permissionFailureMessage(permission.canAskAgain));
        }

        subscriptions.current = [
          recognition.addListener('start', () => {
            if (!sessionIsActive(currentSession)) return;
            setPhase('listening');
          }),
          recognition.addListener('result', (event) => {
            if (!sessionIsActive(currentSession)) return;
            const recognized = event.results.at(0)?.transcript.trim();
            if (recognized === undefined || recognized.length === 0) return;
            onTranscript.current(
              draftPrefix.current.length === 0
                ? recognized
                : `${draftPrefix.current} ${recognized}`,
            );
            if (event.isFinal) setPhase('finishing');
          }),
          recognition.addListener('nomatch', () => {
            if (!sessionIsActive(currentSession)) return;
            if (!aborting.current) {
              onError.current(
                'Vera could not recognize any speech. Try again.',
              );
            }
          }),
          recognition.addListener('error', (event) => {
            if (!sessionIsActive(currentSession)) return;
            if (event.error !== 'aborted' && !aborting.current) {
              onError.current(recognitionEventFailureMessage(event));
            }
          }),
          recognition.addListener('end', () => {
            if (!sessionIsActive(currentSession)) return;
            removeListeners();
            aborting.current = false;
            setPhase('idle');
          }),
        ];

        recognition.start({
          lang: options.locale,
          interimResults: true,
          maxAlternatives: 1,
          continuous: false,
          addsPunctuation: true,
        });
      } catch (cause) {
        if (!sessionIsActive(currentSession)) return;
        removeListeners();
        setPhase('idle');
        const message = cause instanceof Error ? cause.message : '';
        onError.current(
          message.length > 0 && !message.toLowerCase().includes('native module')
            ? message
            : recognitionFailureMessage(),
        );
      }
    },
    [options.locale, phase, removeListeners, sessionIsActive],
  );

  const stop = useCallback(() => {
    if (phase !== 'listening') return;
    setPhase('finishing');
    module.current?.stop();
  }, [phase]);

  return { phase, start, stop, abort };
}
