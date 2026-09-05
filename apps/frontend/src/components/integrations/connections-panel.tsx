import { useState } from 'react';
import {
  CheckCircle2,
  GitBranch,
  PlugZap,
  RefreshCw,
  Unplug,
} from 'lucide-react-native';
import { Text, View } from 'react-native';
import type {
  IntegrationConnectionResource,
  IntegrationDefinitionResource,
} from '@vera/client';

import { palette, spacing } from '@/design/tokens';
import {
  Empty,
  ResourceCard,
  SmallButton,
  Tag,
  formatDate,
} from '../resource-panel/cards.tsx';

export function ConnectionsPanel(props: {
  integrations: IntegrationDefinitionResource[];
  connections: IntegrationConnectionResource[];
  actionId?: string;
  onConnect: (integrationId: string) => Promise<boolean>;
  onVerify: (connectionId: string) => Promise<boolean>;
  onRevoke: (connectionId: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState<string>();
  if (props.integrations.length === 0) {
    return (
      <Empty
        icon={PlugZap}
        title="No integrations available"
        description="This Vera server has not registered any curated external integrations."
      />
    );
  }
  return (
    <View style={{ gap: spacing.md }}>
      <ResourceCard>
        <Tag label="Server-managed access" />
        <Text
          selectable
          style={{ color: palette.text, fontSize: 17, fontWeight: '700' }}
        >
          Connect Vera to your tools
        </Text>
        <Text selectable style={{ color: palette.textSoft, lineHeight: 20 }}>
          Connections enable curated capabilities. Credentials stay on the Vera
          host and are never sent to the app or orchestration model.
        </Text>
      </ResourceCard>
      {props.integrations.map((integration) => {
        const connection = props.connections.find(
          (candidate) => candidate.integrationId === integration.id,
        );
        const active = connection?.status === 'active';
        const busy =
          props.actionId === integration.id ||
          props.actionId === connection?.id;
        const confirmKey = `${integration.id}:${active ? 'revoke' : 'connect'}`;
        return (
          <ResourceCard key={integration.id}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <GitBranch color={palette.accent} size={24} strokeWidth={1.7} />
              <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 18,
                    fontWeight: '700',
                  }}
                >
                  {integration.displayName}
                </Text>
                <Text selectable style={{ color: palette.muted, fontSize: 12 }}>
                  {active
                    ? `Connected as @${connection.account.login}`
                    : 'Not connected'}
                </Text>
              </View>
              <Tag
                label={active ? 'active' : (connection?.status ?? 'available')}
              />
            </View>
            <Text
              selectable
              style={{ color: palette.textSoft, lineHeight: 20 }}
            >
              {integration.description}
            </Text>
            <Text
              selectable
              style={{ color: palette.muted, fontSize: 11, lineHeight: 17 }}
            >
              {integration.operations
                .map((operation) => operation.replaceAll('_', ' '))
                .join(' · ')}
            </Text>
            {active ? (
              <Text selectable style={{ color: palette.faint, fontSize: 11 }}>
                Host session · {connection.credentialBinding.host} · verified{' '}
                {formatDate(connection.lastVerifiedAt)}
              </Text>
            ) : null}
            {confirming === confirmKey ? (
              <View style={{ gap: spacing.sm }}>
                <Text
                  selectable
                  style={{ color: palette.textSoft, lineHeight: 19 }}
                >
                  {active
                    ? "Revoke Vera's access? This does not sign the host out of GitHub."
                    : 'Use the GitHub account already authenticated on the Vera host? No credential will enter this app.'}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: spacing.sm,
                  }}
                >
                  <SmallButton
                    label="Cancel"
                    onPress={() => setConfirming(undefined)}
                  />
                  <SmallButton
                    disabled={busy}
                    icon={active ? Unplug : CheckCircle2}
                    label={
                      busy
                        ? 'Working…'
                        : active
                          ? 'Revoke access'
                          : 'Enable connection'
                    }
                    primary={!active}
                    onPress={() => {
                      const operation = active
                        ? props.onRevoke(connection.id)
                        : props.onConnect(integration.id);
                      void operation.then((completed) => {
                        if (completed) setConfirming(undefined);
                      });
                    }}
                  />
                </View>
              </View>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                {active ? (
                  <SmallButton
                    disabled={busy}
                    icon={RefreshCw}
                    label={busy ? 'Checking…' : 'Verify connection'}
                    onPress={() => void props.onVerify(connection.id)}
                  />
                ) : null}
                <SmallButton
                  disabled={busy}
                  icon={active ? Unplug : PlugZap}
                  label={active ? 'Revoke' : 'Connect'}
                  onPress={() => setConfirming(confirmKey)}
                />
              </View>
            )}
          </ResourceCard>
        );
      })}
    </View>
  );
}
