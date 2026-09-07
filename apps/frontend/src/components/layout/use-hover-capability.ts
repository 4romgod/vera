import { useEffect, useState } from 'react';

export function useHoverCapability(): boolean {
  const [supportsHover, setSupportsHover] = useState(
    process.env.EXPO_OS === 'web',
  );

  useEffect(() => {
    if (
      process.env.EXPO_OS !== 'web' ||
      typeof window.matchMedia !== 'function'
    ) {
      setSupportsHover(false);
      return;
    }

    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const updateHoverSupport = () => setSupportsHover(hoverQuery.matches);
    updateHoverSupport();
    hoverQuery.addEventListener('change', updateHoverSupport);
    return () => hoverQuery.removeEventListener('change', updateHoverSupport);
  }, []);

  return supportsHover;
}
