import type { DeviceVoice, VoicePreferences } from './voice-preferences.ts';

export type VoiceSettingsController = {
  synthesis: {
    loading: boolean;
    enabled: boolean;
    provider?: string;
    model?: string;
    voice?: string;
    voices: string[];
    unavailable: boolean;
    dataBoundary?: 'owner_controlled' | 'third_party';
  };
  locale: string;
  preferences: VoicePreferences;
  voices: DeviceVoice[];
  loadingVoices: boolean;
  effectiveVoice?: DeviceVoice;
  effectiveNeuralVoice?: string;
  selectedNeuralVoiceAvailable: boolean;
  selectedFallbackVoiceAvailable: boolean;
  previewing?: {
    kind: 'neural' | 'fallback';
    voiceId: string | null;
  };
  refreshVoices(): Promise<void>;
  refreshSynthesis(): Promise<void>;
  previewNeural(voiceId?: string): Promise<void>;
  previewFallback(voiceId?: string): Promise<void>;
  stopPreview(): Promise<void>;
  update(changes: Partial<VoicePreferences>): void;
  reset(): void;
};
