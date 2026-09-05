import type { IntegrationConnection } from '../../../../domain/integrations/integration-connection.ts';
import type { IntegrationConnectionStore } from '../../../../ports/persistence/integration-connection-store.ts';

export class InMemoryIntegrationConnectionStore
  implements IntegrationConnectionStore
{
  private readonly connections = new Map<string, IntegrationConnection>();
  private readonly idsByIntegration = new Map<string, string>();

  public create(connection: IntegrationConnection) {
    const key = `${connection.principalId}\u0000${connection.integrationId}`;
    const existingId = this.idsByIntegration.get(key);
    if (existingId !== undefined) {
      const existing = this.connections.get(existingId);
      if (existing === undefined)
        throw new Error('Connection index is invalid.');
      return Promise.resolve({
        created: false,
        connection: structuredClone(existing),
      });
    }
    this.idsByIntegration.set(key, connection.id);
    this.connections.set(connection.id, structuredClone(connection));
    return Promise.resolve({
      created: true,
      connection: structuredClone(connection),
    });
  }

  public findById(principalId: string, connectionId: string) {
    const connection = this.connections.get(connectionId);
    return Promise.resolve(
      connection?.principalId === principalId
        ? structuredClone(connection)
        : null,
    );
  }

  public findByIntegrationId(principalId: string, integrationId: string) {
    const id = this.idsByIntegration.get(
      `${principalId}\u0000${integrationId}`,
    );
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public list(principalId: string) {
    return Promise.resolve(
      [...this.connections.values()]
        .filter((connection) => connection.principalId === principalId)
        .sort((left, right) =>
          left.integrationId.localeCompare(right.integrationId),
        )
        .map((connection) => structuredClone(connection)),
    );
  }

  public replace(connection: IntegrationConnection, expectedVersion: number) {
    const current = this.connections.get(connection.id);
    if (
      current?.principalId !== connection.principalId ||
      current.version !== expectedVersion
    ) {
      return Promise.resolve(false);
    }
    this.connections.set(connection.id, structuredClone(connection));
    return Promise.resolve(true);
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.connections.clear();
    this.idsByIntegration.clear();
    return Promise.resolve();
  }
}
