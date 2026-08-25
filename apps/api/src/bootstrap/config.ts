import { z } from 'zod';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ModelConfig } from '../adapters/outbound/model/model-provider-registry.ts';

const EnvironmentSchema = z.object({
  HOST: z.enum(['127.0.0.1', '::1', 'localhost']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4310),
  VERA_MODEL_PROVIDER: z
    .enum(['ollama', 'openai', 'gemini', 'deterministic'])
    .default('ollama'),
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().min(1).default('gemma4-12b-64k:latest'),
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_MODEL: z.string().trim().min(1).default('gpt-5-mini'),
  GEMINI_BASE_URL: z
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(120_000),
  MODEL_READINESS_TIMEOUT_MS: z.coerce.number().int().min(250).default(3_000),
  MODEL_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(131_072)
    .default(8_192),
  CONVERSATION_CONTEXT_MAX_MESSAGES: z.coerce
    .number()
    .int()
    .min(2)
    .max(100)
    .multipleOf(2)
    .default(20),
  CONVERSATION_CONTEXT_MAX_CHARACTERS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(1_000_000)
    .default(40_000),
  VERA_STORAGE_MODE: z.enum(['persistent', 'memory']).default('persistent'),
  MONGODB_URI: z.url().default('mongodb://127.0.0.1:27017'),
  MONGODB_DATABASE: z.string().min(1).default('vera'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  SCRATCHPAD_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
  DEPENDENCY_TIMEOUT_MS: z.coerce.number().int().min(250).default(3_000),
  VERA_PLANNING_ADAPTER: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .default('codex_cli'),
  CODEX_COMMAND: z.string().min(1).default('codex'),
  CODEX_MODEL: z.string().min(1).optional(),
  VERA_CHANGE_ADAPTER: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .default('codex_cli'),
  CHANGE_CODEX_COMMAND: z.string().min(1).optional(),
  CHANGE_CODEX_MODEL: z.string().min(1).optional(),
  CHANGE_APPLICATION_ROOT: z.string().min(1).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(25).default(250),
  WORKER_LEASE_MS: z.coerce.number().int().min(1_000).default(900_000),
});

export type AppConfig = {
  host: string;
  port: number;
  model: ModelConfig;
  conversationContext: {
    maxMessages: number;
    maxCharacters: number;
  };
  storage: {
    mode: 'persistent' | 'memory';
    mongodbUri: string;
    mongodbDatabase: string;
    redisUrl: string;
    scratchpadTtlSeconds: number;
    dependencyTimeoutMs: number;
  };
  planning: {
    adapterId: string;
    adapters: {
      codexCli: {
        command: string;
        model?: string;
      };
    };
  };
  change: {
    adapterId: string;
    adapters: {
      codexCli: {
        command: string;
        model?: string;
      };
    };
  };
  application: {
    workspacesRoot: string;
  };
  worker: {
    concurrency: number;
    pollIntervalMs: number;
    leaseMs: number;
  };
};

function requireApiKey(
  provider: 'openai' | 'gemini',
  value: string | undefined,
): string {
  if (value === undefined) {
    throw new Error(
      `${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} is required when VERA_MODEL_PROVIDER=${provider}.`,
    );
  }
  return value;
}

function normalizeProviderBaseUrl(
  provider: 'ollama' | 'openai' | 'gemini',
  value: string,
): string {
  const url = new URL(value);
  if (
    (provider === 'openai' || provider === 'gemini') &&
    url.protocol !== 'https:'
  ) {
    throw new Error(
      `${provider === 'openai' ? 'OPENAI_BASE_URL' : 'GEMINI_BASE_URL'} must use HTTPS because it carries provider credentials.`,
    );
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      `${provider.toUpperCase()}_BASE_URL must not contain embedded credentials, a query, or a fragment.`,
    );
  }
  return value.replace(/\/+$/u, '');
}

function createModelConfig(
  parsed: z.infer<typeof EnvironmentSchema>,
): ModelConfig {
  const shared = {
    timeoutMs: parsed.MODEL_TIMEOUT_MS,
    readinessTimeoutMs: parsed.MODEL_READINESS_TIMEOUT_MS,
    maxOutputTokens: parsed.MODEL_MAX_OUTPUT_TOKENS,
  };
  switch (parsed.VERA_MODEL_PROVIDER) {
    case 'deterministic':
      return { provider: 'deterministic', model: 'deterministic-v1' };
    case 'ollama':
      return {
        provider: 'ollama',
        baseUrl: normalizeProviderBaseUrl('ollama', parsed.OLLAMA_BASE_URL),
        model: parsed.OLLAMA_MODEL,
        ...shared,
      };
    case 'openai':
      return {
        provider: 'openai',
        baseUrl: normalizeProviderBaseUrl('openai', parsed.OPENAI_BASE_URL),
        apiKey: requireApiKey('openai', parsed.OPENAI_API_KEY),
        model: parsed.OPENAI_MODEL,
        ...shared,
      };
    case 'gemini':
      return {
        provider: 'gemini',
        baseUrl: normalizeProviderBaseUrl('gemini', parsed.GEMINI_BASE_URL),
        apiKey: requireApiKey('gemini', parsed.GEMINI_API_KEY),
        model: parsed.GEMINI_MODEL.replace(/^models\//u, ''),
        ...shared,
      };
  }
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);

  const changeCodexModel = parsed.CHANGE_CODEX_MODEL ?? parsed.CODEX_MODEL;

  return {
    host: parsed.HOST,
    port: parsed.PORT,
    model: createModelConfig(parsed),
    conversationContext: {
      maxMessages: parsed.CONVERSATION_CONTEXT_MAX_MESSAGES,
      maxCharacters: parsed.CONVERSATION_CONTEXT_MAX_CHARACTERS,
    },
    storage: {
      mode: parsed.VERA_STORAGE_MODE,
      mongodbUri: parsed.MONGODB_URI,
      mongodbDatabase: parsed.MONGODB_DATABASE,
      redisUrl: parsed.REDIS_URL,
      scratchpadTtlSeconds: parsed.SCRATCHPAD_TTL_SECONDS,
      dependencyTimeoutMs: parsed.DEPENDENCY_TIMEOUT_MS,
    },
    planning: {
      adapterId: parsed.VERA_PLANNING_ADAPTER,
      adapters: {
        codexCli: {
          command: parsed.CODEX_COMMAND,
          ...(parsed.CODEX_MODEL === undefined
            ? {}
            : { model: parsed.CODEX_MODEL }),
        },
      },
    },
    change: {
      adapterId: parsed.VERA_CHANGE_ADAPTER,
      adapters: {
        codexCli: {
          command: parsed.CHANGE_CODEX_COMMAND ?? parsed.CODEX_COMMAND,
          ...(changeCodexModel === undefined
            ? {}
            : { model: changeCodexModel }),
        },
      },
    },
    application: {
      workspacesRoot: resolve(
        parsed.CHANGE_APPLICATION_ROOT ??
          join(homedir(), '.vera', 'change-applications'),
      ),
    },
    worker: {
      concurrency: parsed.WORKER_CONCURRENCY,
      pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
      leaseMs: parsed.WORKER_LEASE_MS,
    },
  };
}
