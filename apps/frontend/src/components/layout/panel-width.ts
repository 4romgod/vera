import 'expo-sqlite/localStorage/install';

import { useCallback, useState } from 'react';

import { parseStoredPanelWidth } from './panel-width-values.ts';

export function usePanelWidth(storageKey: string, defaultWidth: number) {
  const [width, setWidth] = useState(() => {
    if (process.env.EXPO_OS !== 'web') return defaultWidth;
    try {
      return (
        parseStoredPanelWidth(localStorage.getItem(storageKey)) ?? defaultWidth
      );
    } catch {
      return defaultWidth;
    }
  });

  const persist = useCallback(
    (nextWidth: number) => {
      setWidth(nextWidth);
      if (process.env.EXPO_OS !== 'web') return;
      try {
        localStorage.setItem(storageKey, String(Math.round(nextWidth)));
      } catch {
        // Resizing remains available for this session when storage is blocked.
      }
    },
    [storageKey],
  );

  return { width, setWidth, persist };
}
