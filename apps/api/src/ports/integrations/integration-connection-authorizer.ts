import type { IntegrationConnection } from '../../domain/integrations/integration-connection.ts';

export type IntegrationConnectionAuthorizer = {
  requireActive(
    principalId: string,
    integrationId: string,
  ): Promise<IntegrationConnection>;
};
