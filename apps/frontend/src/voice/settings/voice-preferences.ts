export const VOICE_RATE_MIN = 0.65;
export const VOICE_RATE_MAX = 1.25;
export const VOICE_PITCH_MIN = 0.8;
export const VOICE_PITCH_MAX = 1.2;

export type VoicePreferences = {
  schemaVersion: 1;
  neuralVoiceId?: string;
  voiceId?: string;
  rate: number;
  pitch: number;
};

export type DeviceVoice = {
  identifier: string;
  name: string;
  quality: 'Default' | 'Enhanced';
  language: string;
  isDefault?: boolean;
  localService?: boolean;
};

export const defaultVoicePreferences: VoicePreferences = {
  schemaVersion: 1,
  rate: 0.95,
  pitch: 1,
};

export function parseVoicePreferences(value: string | null): VoicePreferences {
  if (value === null) return defaultVoicePreferences;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
      return defaultVoicePreferences;
    }
    const voiceId =
      typeof parsed.voiceId === 'string' && parsed.voiceId.trim().length > 0
        ? parsed.voiceId.trim()
        : undefined;
    const neuralVoiceId =
      typeof parsed.neuralVoiceId === 'string' &&
      parsed.neuralVoiceId.trim().length > 0
        ? parsed.neuralVoiceId.trim()
        : undefined;
    return {
      schemaVersion: 1,
      ...(neuralVoiceId === undefined ? {} : { neuralVoiceId }),
      ...(voiceId === undefined ? {} : { voiceId }),
      rate: normalizeRate(parsed.rate),
      pitch: normalizePitch(parsed.pitch),
    };
  } catch {
    return defaultVoicePreferences;
  }
}

export function normalizeVoicePreferences(
  preferences: VoicePreferences,
): VoicePreferences {
  const voiceId = preferences.voiceId?.trim();
  const neuralVoiceId = preferences.neuralVoiceId?.trim();
  return {
    schemaVersion: 1,
    ...(neuralVoiceId === undefined || neuralVoiceId.length === 0
      ? {}
      : { neuralVoiceId }),
    ...(voiceId === undefined || voiceId.length === 0 ? {} : { voiceId }),
    rate: normalizeRate(preferences.rate),
    pitch: normalizePitch(preferences.pitch),
  };
}

export function resolveNeuralVoice(
  voices: readonly string[],
  defaultVoice: string | undefined,
  selectedVoice: string | undefined,
): string | undefined {
  if (selectedVoice !== undefined && voices.includes(selectedVoice)) {
    return selectedVoice;
  }
  if (defaultVoice !== undefined && voices.includes(defaultVoice)) {
    return defaultVoice;
  }
  return voices[0];
}

export function resolveDeviceVoice(
  voices: DeviceVoice[],
  locale: string,
  voiceId?: string,
): DeviceVoice | undefined {
  if (voiceId !== undefined) {
    const selected = voices.find((voice) => voice.identifier === voiceId);
    if (selected !== undefined) return selected;
  }

  const normalizedLocale = normalizeLocale(locale);
  const language = normalizedLocale.split('-')[0];
  const ranked = sortDeviceVoices(voices, locale);
  return (
    ranked.find(
      (voice) =>
        normalizeLocale(voice.language) === normalizedLocale &&
        (voice.quality === 'Enhanced' || voice.isDefault === true),
    ) ??
    ranked.find(
      (voice) =>
        normalizeLocale(voice.language).split('-')[0] === language &&
        (voice.quality === 'Enhanced' || voice.isDefault === true),
    ) ??
    ranked.find((voice) => voice.isDefault === true)
  );
}

export function sortDeviceVoices(
  voices: DeviceVoice[],
  locale: string,
): DeviceVoice[] {
  const normalizedLocale = normalizeLocale(locale);
  const language = normalizedLocale.split('-')[0];
  return [...voices].sort((left, right) =>
    compareVoiceRank(left, right, normalizedLocale, language),
  );
}

export function recommendedDeviceVoices(
  voices: DeviceVoice[],
  locale: string,
  limit = 8,
): DeviceVoice[] {
  const language = normalizeLocale(locale).split('-')[0];
  return sortDeviceVoices(voices, locale)
    .filter(
      (voice) =>
        normalizeLocale(voice.language).split('-')[0] === language &&
        (voice.quality === 'Enhanced' || voice.isDefault === true),
    )
    .slice(0, Math.max(0, limit));
}

export function isVoiceAvailable(
  voices: DeviceVoice[],
  voiceId?: string,
): boolean {
  return (
    voiceId === undefined ||
    voices.some((voice) => voice.identifier === voiceId)
  );
}

export function normalizeRate(value: unknown): number {
  return normalizeNumber(
    value,
    defaultVoicePreferences.rate,
    VOICE_RATE_MIN,
    VOICE_RATE_MAX,
  );
}

export function normalizePitch(value: unknown): number {
  return normalizeNumber(
    value,
    defaultVoicePreferences.pitch,
    VOICE_PITCH_MIN,
    VOICE_PITCH_MAX,
  );
}

function compareVoiceRank(
  left: DeviceVoice,
  right: DeviceVoice,
  locale: string,
  language: string,
): number {
  const rank = (voice: DeviceVoice): number => {
    const voiceLocale = normalizeLocale(voice.language);
    const localeRank =
      voiceLocale === locale
        ? 0
        : voiceLocale.split('-')[0] === language
          ? 1
          : 2;
    const qualityRank = voice.quality === 'Enhanced' ? 0 : 1;
    const defaultRank = voice.isDefault === true ? 0 : 1;
    const localRank = voice.localService === false ? 1 : 0;
    return localeRank * 100 + qualityRank * 10 + defaultRank * 2 + localRank;
  };
  return (
    rank(left) - rank(right) ||
    left.name.localeCompare(right.name) ||
    left.identifier.localeCompare(right.identifier)
  );
}

function normalizeLocale(locale: string): string {
  return locale.trim().replaceAll('_', '-').toLowerCase();
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, value)) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
