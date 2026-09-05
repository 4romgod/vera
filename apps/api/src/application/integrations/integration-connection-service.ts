import { createHash, randomUUID } from 'node:crypto';

import {
  IntegrationConnectionSchema,
  type IntegrationDefinition,
  type IntegrationConnection,
  type PublicIntegrationConnection,
} from '../../domain/integrations/integration-connection.ts';
import type { IntegrationConnector } from '../../ports/integrations/integration-connector.ts';
import type { IntegrationConnectionStore } from '../../ports/persistence/integration-connection-store.ts';

export type IntegrationConnectionErrorCode =
  | 'integration_not_found'
  | 'connection_not_found'
  | 'integration_unavailable'
  | 'connection_conflict';

export class IntegrationConnectionError extends Error {
  public constructor(
    message: string,
    public readonly code: IntegrationConnectionErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'IntegrationConnectionError';
  }
}

export type IntegrationConnectionService = {
  catalog(): { schemaVersion: 1; integrations: IntegrationDefinition[] };
  connect(input: {
    principalId: string;
    integrationId: string;
    requestKey: string;
  }): Promise<PublicIntegrationConnection>;
  get(
    principalId: string,
    connectionId: string,
  ): Promise<PublicIntegrationConnection>;
  list(principalId: string): Promise<PublicIntegrationConnection[]>;
  verify(
    principalId: string,
    connectionId: string,
  ): Promise<PublicIntegrationConnection>;
  revoke(
    principalId: string,
    connectionId: string,
  ): Promise<PublicIntegrationConnection>;
  requireActive(
    principalId: string,
    integrationId: string,
  ): Promise<IntegrationConnection>;
};

function deterministicConnectionId(principalId: string, integrationId: string) {
  const digest = createHash('sha256')
    .update(`${principalId}\u0000${integrationId}`)
    .digest('hex')
    .slice(0, 32);
  return `connection_${digest}`;
}

function publicConnection(connection: IntegrationConnection) {
  const {
    principalId: ignoredPrincipal,
    requestKey: ignoredKey,
    events: ignoredEvents,
    ...value
  } = connection;
  void ignoredPrincipal;
  void ignoredKey;
  void ignoredEvents;
  return value;
}

export function createIntegrationConnectionService(options: {
  store: IntegrationConnectionStore;
  connectors: IntegrationConnector[];
  clock?: () => string;
  createId?: (prefix: string) => string;
}): IntegrationConnectionService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const connectorFor = (integrationId: string) =>
    options.connectors.find(
      (connector) => connector.definition.id === integrationId,
    );

  async function requireConnection(principalId: string, connectionId: string) {
    const connection = await options.store.findById(principalId, connectionId);
    if (connection === null) {
      throw new IntegrationConnectionError(
        `Connection ${connectionId} was not found.`,
        'connection_not_found',
      );
    }
    return connection;
  }

  async function update(
    principalId: string,
    connectionId: string,
    mutate: (connection: IntegrationConnection) => Promise<boolean> | boolean,
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await requireConnection(principalId, connectionId);
      const candidate = structuredClone(current);
      if (!(await mutate(candidate))) return current;
      candidate.version = current.version + 1;
      const parsed = IntegrationConnectionSchema.parse(candidate);
      if (await options.store.replace(parsed, current.version)) return parsed;
    }
    throw new IntegrationConnectionError(
      `Connection ${connectionId} changed concurrently.`,
      'connection_conflict',
    );
  }

  function append(
    connection: IntegrationConnection,
    type: IntegrationConnection['events'][number]['type'],
    occurredAt: string,
  ) {
    connection.events.push({
      schemaVersion: 1,
      id: createId('event'),
      sequence: connection.events.length + 1,
      type,
      occurredAt,
      data: {},
    });
    connection.updatedAt = occurredAt;
  }

  async function inspect(connector: IntegrationConnector) {
    try {
      return await connector.inspectAccount();
    } catch (error) {
      throw new IntegrationConnectionError(
        `${connector.definition.displayName} is not available to Vera on this host.`,
        'integration_unavailable',
        { cause: error },
      );
    }
  }

  async function activateExisting(
    existing: IntegrationConnection,
    input: {
      principalId: string;
      requestKey: string;
    },
    connector: IntegrationConnector,
    account: IntegrationConnection['account'],
  ) {
    if (existing.status === 'active') {
      if (existing.account.providerAccountId !== account.providerAccountId) {
        throw new IntegrationConnectionError(
          'The host session now belongs to a different account. Revoke and reconnect it explicitly.',
          'connection_conflict',
        );
      }
      return existing;
    }
    return update(input.principalId, existing.id, (candidate) => {
      const now = clock();
      candidate.status = 'active';
      candidate.requestKey = input.requestKey;
      candidate.adapterId = connector.adapterId;
      candidate.credentialBinding = connector.credentialBinding;
      candidate.account = account;
      candidate.operations = [...connector.definition.operations];
      candidate.lastVerifiedAt = now;
      delete candidate.revokedAt;
      append(candidate, 'connection_enabled', now);
      return true;
    });
  }

  return {
    catalog: () => ({
      schemaVersion: 1,
      integrations: options.connectors.map(({ definition }) => definition),
    }),

    async connect(input) {
      const connector = connectorFor(input.integrationId);
      if (connector === undefined) {
        throw new IntegrationConnectionError(
          `Integration ${input.integrationId} was not found.`,
          'integration_not_found',
        );
      }
      const account = await inspect(connector);
      const existing = await options.store.findByIntegrationId(
        input.principalId,
        input.integrationId,
      );
      if (existing !== null) {
        return publicConnection(
          await activateExisting(existing, input, connector, account),
        );
      }
      const now = clock();
      const connection = IntegrationConnectionSchema.parse({
        schemaVersion: 1,
        version: 1,
        id: deterministicConnectionId(input.principalId, input.integrationId),
        requestKey: input.requestKey,
        principalId: input.principalId,
        integrationId: input.integrationId,
        adapterId: connector.adapterId,
        status: 'active',
        credentialBinding: connector.credentialBinding,
        account,
        operations: connector.definition.operations,
        lastVerifiedAt: now,
        events: [
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 1,
            type: 'connection_enabled',
            occurredAt: now,
            data: {},
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      const stored = await options.store.create(connection);
      return publicConnection(
        stored.created
          ? stored.connection
          : await activateExisting(
              stored.connection,
              input,
              connector,
              account,
            ),
      );
    },

    async get(principalId, connectionId) {
      return publicConnection(
        await requireConnection(principalId, connectionId),
      );
    },

    async list(principalId) {
      return (await options.store.list(principalId)).map(publicConnection);
    },

    async verify(principalId, connectionId) {
      const current = await requireConnection(principalId, connectionId);
      const connector = connectorFor(current.integrationId);
      if (connector === undefined) {
        throw new IntegrationConnectionError(
          `Integration ${current.integrationId} was not found.`,
          'integration_not_found',
        );
      }
      const account = await inspect(connector);
      if (account.providerAccountId !== current.account.providerAccountId) {
        throw new IntegrationConnectionError(
          'The host session now belongs to a different account. Revoke and reconnect it explicitly.',
          'connection_conflict',
        );
      }
      const verified = await update(principalId, connectionId, (candidate) => {
        const now = clock();
        candidate.account = account;
        candidate.lastVerifiedAt = now;
        append(candidate, 'connection_verified', now);
        return true;
      });
      return publicConnection(verified);
    },

    async revoke(principalId, connectionId) {
      const revoked = await update(principalId, connectionId, (candidate) => {
        if (candidate.status === 'revoked') return false;
        const now = clock();
        candidate.status = 'revoked';
        candidate.revokedAt = now;
        append(candidate, 'connection_revoked', now);
        return true;
      });
      return publicConnection(revoked);
    },

    async requireActive(principalId, integrationId) {
      const connection = await options.store.findByIntegrationId(
        principalId,
        integrationId,
      );
      if (connection?.status !== 'active') {
        throw new IntegrationConnectionError(
          `${integrationId} is not connected for this Vera owner.`,
          'connection_not_found',
        );
      }
      return connection;
    },
  };
}
