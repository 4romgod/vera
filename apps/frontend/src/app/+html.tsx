import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

import { palette } from '@/design/tokens';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ backgroundColor: palette.canvas }}>
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <ScrollViewStyleReset />
        <style>{`html, body, #root { min-height: 100%; background: ${palette.canvas}; } body { margin: 0; overscroll-behavior: none; }`}</style>
      </head>
      <body style={{ backgroundColor: palette.canvas }}>{children}</body>
    </html>
  );
}
