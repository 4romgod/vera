import { useEffect, useRef } from 'react';
import type { VeraClient } from '@vera/client';

import { ConnectionsPanel } from '@/components/integrations/connections-panel';
import { useIntegrationConnections } from '@/components/integrations/use-integration-connections';

export function ConnectionsSettingsTab(props: {
  client: VeraClient;
  onError: (message: string | undefined) => void;
}) {
  const mounted = useRef(true);
  const connections = useIntegrationConnections({
    client: props.client,
    mounted,
    onError: props.onError,
  });

  useEffect(() => {
    mounted.current = true;
    void connections.refresh().catch(() => {
      if (mounted.current)
        props.onError('Vera could not load connection settings.');
    });
    return () => {
      mounted.current = false;
    };
  }, [connections.refresh, props.onError]);

  return (
    <ConnectionsPanel
      actionId={connections.actionId}
      connections={connections.connections}
      integrations={connections.integrations}
      onConnect={connections.connect}
      onRevoke={connections.revoke}
      onVerify={connections.verify}
    />
  );
}
