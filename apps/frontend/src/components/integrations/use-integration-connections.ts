import { useCallback, useState, type RefObject } from 'react';
import type {
  IntegrationConnectionResource,
  IntegrationDefinitionResource,
  VeraClient,
} from '@vera/client';

import { errorMessage } from '@/components/assistant/run-status';

function connectionRequestKey(): string {
  return `connection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useIntegrationConnections(options: {
  client: VeraClient;
  mounted: RefObject<boolean>;
  onError: (message: string | undefined) => void;
}) {
  const [integrations, setIntegrations] = useState<
    IntegrationDefinitionResource[]
  >([]);
  const [connections, setConnections] = useState<
    IntegrationConnectionResource[]
  >([]);
  const [actionId, setActionId] = useState<string>();

  const refresh = useCallback(async () => {
    const [catalog, page] = await Promise.all([
      options.client.listIntegrations(),
      options.client.listIntegrationConnections(),
    ]);
    if (!options.mounted.current) return;
    setIntegrations(catalog.integrations);
    setConnections(page.connections);
  }, [options.client, options.mounted]);

  const connect = useCallback(
    async (integrationId: string) => {
      setActionId(integrationId);
      try {
        const connection = await options.client.connectIntegration({
          integrationId,
          idempotencyKey: connectionRequestKey(),
        });
        if (options.mounted.current) {
          setConnections((current) => [
            connection,
            ...current.filter((candidate) => candidate.id !== connection.id),
          ]);
          options.onError(undefined);
        }
        return true;
      } catch (cause) {
        if (options.mounted.current) {
          options.onError(
            errorMessage(cause, 'Vera could not enable that connection.'),
          );
        }
        return false;
      } finally {
        if (options.mounted.current) setActionId(undefined);
      }
    },
    [options.client, options.mounted, options.onError],
  );

  const verify = useCallback(
    async (connectionId: string) => {
      setActionId(connectionId);
      try {
        const connection =
          await options.client.verifyIntegrationConnection(connectionId);
        if (options.mounted.current) {
          setConnections((current) =>
            current.map((candidate) =>
              candidate.id === connection.id ? connection : candidate,
            ),
          );
          options.onError(undefined);
        }
        return true;
      } catch (cause) {
        if (options.mounted.current) {
          options.onError(
            errorMessage(cause, 'Vera could not verify that connection.'),
          );
        }
        return false;
      } finally {
        if (options.mounted.current) setActionId(undefined);
      }
    },
    [options.client, options.mounted, options.onError],
  );

  const revoke = useCallback(
    async (connectionId: string) => {
      setActionId(connectionId);
      try {
        const connection =
          await options.client.revokeIntegrationConnection(connectionId);
        if (options.mounted.current) {
          setConnections((current) =>
            current.map((candidate) =>
              candidate.id === connection.id ? connection : candidate,
            ),
          );
          options.onError(undefined);
        }
        return true;
      } catch (cause) {
        if (options.mounted.current) {
          options.onError(
            errorMessage(cause, 'Vera could not revoke that connection.'),
          );
        }
        return false;
      } finally {
        if (options.mounted.current) setActionId(undefined);
      }
    },
    [options.client, options.mounted, options.onError],
  );

  return {
    integrations,
    connections,
    actionId,
    refresh,
    connect,
    verify,
    revoke,
  };
}
