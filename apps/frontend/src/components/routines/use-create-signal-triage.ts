import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import type { VeraClient } from '@vera/client';
import { errorMessage } from '@/components/assistant/run-status';

export type SignalTriageInput = {
  title: string;
  projectId: string;
  categories: (
    | 'review_requested'
    | 'mentioned'
    | 'assigned'
    | 'failed_check'
  )[];
  expiresAt: string;
  maxOccurrencesPerDay: number;
  maxTotalOccurrences: number;
};

export function useCreateSignalTriage({
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
    async (input: SignalTriageInput): Promise<boolean> => {
      setActionId('create');
      try {
        await client.createRoutine({
          title: input.title,
          trigger: {
            kind: 'external_signal',
            integrationId: 'github',
            projectId: input.projectId,
            categories: input.categories,
          },
          action: {
            kind: 'signal_triage',
            response: 'investigate_and_propose',
            disclosure: 'minimized_signal_evidence',
          },
          limits: {
            expiresAt: input.expiresAt,
            maxOccurrencesPerDay: input.maxOccurrencesPerDay,
            maxTotalOccurrences: input.maxTotalOccurrences,
          },
          idempotencyKey: requestKey(),
        });
        await refreshResources();
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(
            errorMessage(
              cause,
              'Vera could not create that standing triage routine.',
            ),
          );
        return false;
      } finally {
        if (mounted.current) setActionId(undefined);
      }
    },
    [client, mounted, refreshResources, requestKey, setActionId, setError],
  );
}
