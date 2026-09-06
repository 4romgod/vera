import { useCallback, useSyncExternalStore } from 'react';
import 'expo-sqlite/localStorage/install';

import {
  defaultVoicePreferences,
  normalizeVoicePreferences,
  parseVoicePreferences,
  type VoicePreferences,
} from './voice-preferences.ts';

const STORAGE_KEY = 'vera.voicePreferences.v1';
const listeners = new Set<() => void>();
let currentPreferences = readPreferences();

export function useVoicePreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const update = useCallback((changes: Partial<VoicePreferences>) => {
    savePreferences({ ...currentPreferences, ...changes, schemaVersion: 1 });
  }, []);

  const reset = useCallback(() => {
    savePreferences(defaultVoicePreferences);
  }, []);

  return { preferences, update, reset };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): VoicePreferences {
  return currentPreferences;
}

function getServerSnapshot(): VoicePreferences {
  return defaultVoicePreferences;
}

function savePreferences(preferences: VoicePreferences): void {
  currentPreferences = normalizeVoicePreferences(preferences);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPreferences));
    }
  } catch {
    // Preferences still apply for this session if device storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function readPreferences(): VoicePreferences {
  try {
    return typeof localStorage === 'undefined'
      ? defaultVoicePreferences
      : parseVoicePreferences(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultVoicePreferences;
  }
}
