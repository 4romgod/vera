import { useEffect, useRef, useState } from 'react';

import type {
  ConversationMessageResource,
  TaskResource,
  VeraApi,
} from '@vera/client';

const MAX_CONCURRENT_REQUESTS = 4;

export function useTaskDetails(
  client: VeraApi,
  messages: ConversationMessageResource[],
): ReadonlyMap<string, TaskResource | null> {
  const cache = useRef(new Map<string, TaskResource | null>());
  const generation = useRef(0);
  const [details, setDetails] = useState<
    ReadonlyMap<string, TaskResource | null>
  >(() => new Map());

  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    const taskIds = Array.from(
      new Set(
        messages.flatMap((message) =>
          message.role === 'vera' && message.taskId !== undefined
            ? [message.taskId]
            : [],
        ),
      ),
    );
    const visible = new Map<string, TaskResource | null>();
    const missing: string[] = [];
    for (const taskId of taskIds) {
      if (cache.current.has(taskId)) {
        visible.set(taskId, cache.current.get(taskId) ?? null);
      } else {
        missing.push(taskId);
      }
    }
    setDetails(visible);
    if (missing.length === 0) return;

    let cursor = 0;
    const worker = async () => {
      while (cursor < missing.length) {
        const taskId = missing[cursor];
        cursor += 1;
        try {
          cache.current.set(taskId, await client.getTask(taskId));
        } catch {
          cache.current.set(taskId, null);
        }
      }
    };
    void Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_REQUESTS, missing.length) },
        worker,
      ),
    ).then(() => {
      if (generation.current !== currentGeneration) return;
      setDetails(
        new Map(
          taskIds.map((taskId) => [taskId, cache.current.get(taskId) ?? null]),
        ),
      );
    });
  }, [client, messages]);

  return details;
}
