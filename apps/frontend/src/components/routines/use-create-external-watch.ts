import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import type { VeraClient } from '@vera/client';
import { errorMessage } from '@/components/assistant/run-status';

export type ExternalWatchInput = {
  title: string;
  projectId: string;
  minutes: number;
  categories: (
    | 'review_requested'
    | 'mentioned'
    | 'assigned'
    | 'failed_check'
  )[];
};

export function useCreateExternalWatch({
  client,
  refreshResources,
  mounted,
  requestKey,
  setActionId,
  setError,
}: {
  client: Pick<VeraClient, 'createRoutine'>;
  refreshResources: () => Promise<void>;
  mounted: RefObject<boolean>;
  requestKey: () => string;
  setActionId: Dispatch<SetStateAction<string | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
}) {
  return useCallback(
    async (input: ExternalWatchInput): Promise<boolean> => {
      setActionId('create');
      try {
        await client.createRoutine({
          title: input.title,
          schedule: { kind: 'interval', minutes: input.minutes },
          action: {
            kind: 'integration_awareness',
            integrationId: 'github',
            projectId: input.projectId,
            categories: input.categories,
          },
          idempotencyKey: requestKey(),
        });
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(
            errorMessage(cause, 'Vera could not create that external watch.'),
          );
        return false;
      } finally {
        if (mounted.current) setActionId(undefined);
      }
    },
    [client, mounted, refreshResources, requestKey, setActionId, setError],
  );
}
