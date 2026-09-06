const configuredApiUrl = process.env.EXPO_PUBLIC_VERA_API_URL?.trim();
const defaultApiUrl =
  process.env.EXPO_OS === 'android'
    ? 'http://10.0.2.2:4310'
    : 'http://127.0.0.1:4310';

export const apiUrl =
  configuredApiUrl === undefined || configuredApiUrl.length === 0
    ? defaultApiUrl
    : configuredApiUrl;

const configuredSpeechLocale =
  process.env.EXPO_PUBLIC_VERA_SPEECH_LOCALE?.trim();

export const speechLocale =
  configuredSpeechLocale === undefined || configuredSpeechLocale.length === 0
    ? 'en-US'
    : configuredSpeechLocale;
