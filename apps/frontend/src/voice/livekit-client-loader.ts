// Keep this extensionless so Metro selects livekit-runtime.native.ts on devices.
import { initializeLiveKit } from '@/voice/livekit-runtime';

export function createRegisteredModuleLoader<T>(options: {
  initialize(): void;
  load(): Promise<T>;
}) {
  let pending: Promise<T> | undefined;
  return () => {
    options.initialize();
    return (pending ??= options.load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
  };
}

export const loadLiveKitClient = createRegisteredModuleLoader({
  initialize: initializeLiveKit,
  load: () => import('livekit-client'),
});
