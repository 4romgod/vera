import type { IntegrationConnection } from '../../domain/integrations/integration-connection.ts';

export type IntegrationConnectionStore = {
  create(connection: IntegrationConnection): Promise<{
    created: boolean;
    connection: IntegrationConnection;
  }>;
  findById(
    principalId: string,
    connectionId: string,
  ): Promise<IntegrationConnection | null>;
  findByIntegrationId(
    principalId: string,
    integrationId: string,
  ): Promise<IntegrationConnection | null>;
  list(principalId: string): Promise<IntegrationConnection[]>;
  replace(
    connection: IntegrationConnection,
    expectedVersion: number,
  ): Promise<boolean>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
