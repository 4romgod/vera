import type {
  IntegrationAccount,
  IntegrationDefinition,
} from '../../domain/integrations/integration-connection.ts';

export type IntegrationConnector = {
  readonly adapterId: string;
  readonly definition: IntegrationDefinition;
  readonly credentialBinding: { kind: 'host_session'; host: string };
  inspectAccount(): Promise<IntegrationAccount>;
};
