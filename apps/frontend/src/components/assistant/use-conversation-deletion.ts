import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { ConversationSummaryResource, VeraApi } from '@vera/client';

import { errorMessage } from './run-status.tsx';

export function useConversationDeletion(input: {
  client: VeraApi;
  selectedConversationId?: string;
  mounted: { readonly current: boolean };
  setConversations: Dispatch<SetStateAction<ConversationSummaryResource[]>>;
  onDeleteSelected: () => void;
  onError: (message: string | undefined) => void;
}): (id: string) => Promise<boolean> {
  return useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await input.client.deleteConversation(id);
        if (!input.mounted.current) return true;
        input.setConversations((current) =>
          current.filter((candidate) => candidate.id !== id),
        );
        if (input.selectedConversationId === id) input.onDeleteSelected();
        input.onError(undefined);
        return true;
      } catch (cause) {
        if (input.mounted.current) {
          input.onError(
            errorMessage(cause, 'Vera could not delete that conversation.'),
          );
        }
        return false;
      }
    },
    [input],
  );
}
