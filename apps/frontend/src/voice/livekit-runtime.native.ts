import { AudioSession, registerGlobals } from '@livekit/react-native';

let initialized = false;

export function initializeLiveKit() {
  if (initialized) return;
  registerGlobals();
  initialized = true;
}

export function startLiveKitAudioSession() {
  initializeLiveKit();
  return AudioSession.startAudioSession();
}

export function stopLiveKitAudioSession() {
  return AudioSession.stopAudioSession();
}
