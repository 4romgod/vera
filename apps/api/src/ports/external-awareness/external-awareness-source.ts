import type {
  ExternalSignalCategory,
  ExternalSignalObservation,
} from '../../domain/external-awareness/external-signal.ts';

export type ExternalAwarenessSource = {
  integrationId: string;
  observe(input: {
    principalId: string;
    connectionId: string;
    account: { providerAccountId: string; login: string };
    repository: { provider: 'github'; owner: string; name: string };
    categories: ExternalSignalCategory[];
  }): Promise<{
    observations: ExternalSignalObservation[];
    complete: boolean;
  }>;
  checkReadiness(): Promise<void>;
};
