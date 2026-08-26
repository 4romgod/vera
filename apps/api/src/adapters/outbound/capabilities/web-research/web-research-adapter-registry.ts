import { DeterministicWebResearchCapability } from './deterministic-web-research-capability.ts';
import { OpenAiWebResearchCapability } from './openai-web-research-capability.ts';
import type {
  WebResearchCapability,
  WebResearchCapabilityRegistry,
} from '../../../../ports/capabilities/web-research-capability.ts';
import { sameCapabilityDestination } from '../../../../domain/capabilities/capability-destination.ts';

export type WebResearchAdapterConfig =
  | { adapterId: 'disabled' }
  | { adapterId: 'deterministic_research' }
  | {
      adapterId: 'openai_web_search';
      openai: {
        baseUrl: string;
        apiKey: string;
        model: string;
        timeoutMs: number;
        readinessTimeoutMs: number;
        maxOutputTokens: number;
        searchContextSize: 'low' | 'medium' | 'high';
      };
    };

export function createWebResearchCapabilityRegistry(
  config: WebResearchAdapterConfig,
): WebResearchCapabilityRegistry {
  const adapters: WebResearchCapability[] = [
    new DeterministicWebResearchCapability(),
    ...(config.adapterId === 'openai_web_search'
      ? [
          new OpenAiWebResearchCapability({
            ...config.openai,
            maxWebSearchCalls: 4,
          }),
        ]
      : []),
  ];
  const selectedId = config.adapterId;
  return {
    selected() {
      if (selectedId === 'disabled') return null;
      const selected = adapters.find(
        (adapter) => adapter.destination.adapterId === selectedId,
      );
      if (selected === undefined) {
        throw new Error(
          `Configured web-research adapter ${selectedId} is not registered.`,
        );
      }
      return selected;
    },
    resolve(destination) {
      return (
        adapters.find((adapter) =>
          sameCapabilityDestination(adapter.destination, destination),
        ) ?? null
      );
    },
  };
}
