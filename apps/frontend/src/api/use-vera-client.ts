import { useMemo } from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import { VeraClient } from '@vera/client';

import { apiUrl } from '@/config/runtime-config';

export function useVeraClient(): VeraClient {
  return useMemo(
    () =>
      new VeraClient({
        baseUrl: apiUrl,
        fetch: (input, init) => expoFetch(input, init),
      }),
    [],
  );
}
