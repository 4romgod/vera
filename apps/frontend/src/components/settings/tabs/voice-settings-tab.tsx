import { VoiceSettings } from '@/components/settings/voice-settings';
import { speechLocale } from '@/config/runtime-config';
import { useSpokenReply } from '@/voice/use-spoken-reply';
import { useMemo } from 'react';
import type { VeraClient } from '@vera/client';

export function VoiceSettingsTab(props: {
  client: VeraClient;
  onError: (message: string) => void;
}) {
  const speechSynthesis = useMemo(
    () => ({
      availability: () => props.client.getSpeechSynthesisAvailability(),
      synthesize: (input: { text: string; signal?: AbortSignal }) =>
        props.client.synthesizeSpeech(input),
    }),
    [props.client],
  );
  const spokenReply = useSpokenReply({
    locale: speechLocale,
    onError: props.onError,
    speechSynthesis,
  });
  return <VoiceSettings controller={spokenReply.voiceSettings} />;
}
