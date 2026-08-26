import { DeterministicModelProvider } from './deterministic-model-provider.ts';
import { GeminiModelProvider } from './gemini-model-provider.ts';
import type { ModelProvider } from '../../../ports/model/model-provider.ts';
import { OllamaModelProvider } from './ollama-model-provider.ts';
import type { OllamaThink } from './ollama-model-provider.ts';
import { OpenAiModelProvider } from './openai-model-provider.ts';

export type ModelProviderId = 'ollama' | 'openai' | 'gemini' | 'deterministic';

type RemoteModelConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  readinessTimeoutMs: number;
  maxOutputTokens: number;
};

export type ModelConfig =
  | ({ provider: 'ollama'; think: OllamaThink } & RemoteModelConfig)
  | ({ provider: 'openai'; apiKey: string } & RemoteModelConfig)
  | ({ provider: 'gemini'; apiKey: string } & RemoteModelConfig)
  | { provider: 'deterministic'; model: 'deterministic-v1' };

type ModelProviderFactory = (config: ModelConfig) => ModelProvider;

function requireProviderConfig<T extends ModelProviderId>(
  config: ModelConfig,
  provider: T,
): Extract<ModelConfig, { provider: T }> {
  if (config.provider !== provider) {
    throw new Error(`Model provider configuration mismatch for ${provider}.`);
  }
  return config as Extract<ModelConfig, { provider: T }>;
}

const providerFactories = new Map<ModelProviderId, ModelProviderFactory>([
  ['deterministic', () => new DeterministicModelProvider()],
  [
    'ollama',
    (config) =>
      new OllamaModelProvider(requireProviderConfig(config, 'ollama')),
  ],
  [
    'openai',
    (config) =>
      new OpenAiModelProvider(requireProviderConfig(config, 'openai')),
  ],
  [
    'gemini',
    (config) =>
      new GeminiModelProvider(requireProviderConfig(config, 'gemini')),
  ],
]);

export function registeredModelProviders(): ModelProviderId[] {
  return [...providerFactories.keys()];
}

export function createModelProvider(config: ModelConfig): ModelProvider {
  const factory = providerFactories.get(config.provider);
  if (factory === undefined) {
    throw new Error(
      `Unknown model provider "${config.provider}". Registered providers: ${registeredModelProviders().join(', ')}.`,
    );
  }
  return factory(config);
}
