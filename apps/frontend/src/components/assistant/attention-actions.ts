import { Linking } from 'react-native';
import type {
  AttentionBriefing,
  AttentionItem,
  TaskResource,
  VeraClient,
} from '@vera/client';
import type { ResourceTab } from '@/components/resource-panel';
import { errorMessage } from '@/components/assistant/run-status';

type AttentionActionOptions = {
  client: VeraClient;
  isMounted: () => boolean;
  onBriefing: (briefing: AttentionBriefing) => void;
  onCloseResources: () => void;
  onOpenResources: (tab: ResourceTab) => void;
  onSelectConversation: (conversationId: string) => Promise<void>;
  onRun: (task: TaskResource) => void;
  onFollowRun: (task: TaskResource) => void;
  onError: (message: string | undefined) => void;
};

function requestKey(): string {
  return `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function newestAttention(
  current: AttentionBriefing | undefined,
  incoming: AttentionBriefing,
): AttentionBriefing {
  return current !== undefined && current.generatedAt > incoming.generatedAt
    ? current
    : incoming;
}

export function createAttentionActions(options: AttentionActionOptions) {
  async function decideAttention(
    item: AttentionItem,
    decision: 'dismiss' | 'snooze' | 'restore',
  ): Promise<boolean> {
    try {
      const updated = await options.client.decideAttention({
        attentionItemId: item.id,
        decision,
        ...(decision === 'snooze'
          ? {
              snoozedUntil: new Date(
                Date.now() + 60 * 60 * 1_000,
              ).toISOString(),
            }
          : {}),
        idempotencyKey: requestKey(),
      });
      if (options.isMounted()) {
        options.onBriefing(updated);
        options.onError(undefined);
      }
      return true;
    } catch (cause) {
      if (options.isMounted()) {
        options.onError(
          errorMessage(cause, 'Vera could not update that item.'),
        );
      }
      return false;
    }
  }

  async function handleAttention(item: AttentionItem): Promise<boolean> {
    if (item.target.kind !== 'external_signal') return false;
    try {
      let task: TaskResource;
      if (
        item.target.conversationId !== undefined &&
        item.target.runId !== undefined
      ) {
        options.onCloseResources();
        await options.onSelectConversation(item.target.conversationId);
        task = await options.client.getRun(item.target.runId);
      } else {
        task = await options.client.handleExternalSignal({
          signalId: item.target.externalSignalId,
          idempotencyKey: `assistant-signal-triage-${item.id}`,
        });
        if (task.conversationId === undefined) {
          throw new Error('Signal triage did not create a conversation.');
        }
        options.onCloseResources();
        await options.onSelectConversation(task.conversationId);
      }
      options.onRun(task);
      options.onError(undefined);
      if (
        !['succeeded', 'rejected', 'failed', 'cancelled'].includes(
          task.runStatus,
        )
      ) {
        options.onFollowRun(task);
      }
      return true;
    } catch (cause) {
      options.onError(
        errorMessage(cause, 'Vera could not handle that signal.'),
      );
      return false;
    }
  }

  async function openAttentionItem(item: AttentionItem): Promise<void> {
    switch (item.target.kind) {
      case 'task':
        if (item.target.conversationId !== undefined) {
          options.onCloseResources();
          await options.onSelectConversation(item.target.conversationId);
        } else {
          try {
            options.onRun(await options.client.getRun(item.target.runId));
            options.onCloseResources();
          } catch (cause) {
            options.onError(
              errorMessage(cause, 'That run could not be opened.'),
            );
          }
        }
        return;
      case 'personal_task':
        options.onOpenResources('tasks');
        return;
      case 'reminder':
        options.onOpenResources('reminders');
        return;
      case 'mission':
        options.onOpenResources('missions');
        return;
      case 'campaign':
        options.onOpenResources('campaigns');
        return;
      case 'routine':
        options.onOpenResources('routines');
        return;
      case 'external_signal':
        try {
          await Linking.openURL(item.target.url);
        } catch (cause) {
          options.onError(
            errorMessage(cause, 'That external signal could not be opened.'),
          );
        }
    }
  }

  return { decideAttention, handleAttention, openAttentionItem };
}
