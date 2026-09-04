import { z } from 'zod';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ModelConfig } from '../adapters/outbound/model/model-provider-registry.ts';
import type { WebResearchAdapterConfig } from '../adapters/outbound/capabilities/web-research/web-research-adapter-registry.ts';
import type { SpeechTranscriptionConfig } from '../adapters/outbound/transcription/speech-transcription-provider-registry.ts';
import type { PushProviderConfig } from '../adapters/outbound/notifications/push-notification-provider-registry.ts';
import {
  MachineCatalogSchema,
  type MachineCatalog,
} from '../domain/machines/machine.ts';
import {
  DevelopmentCampaignCatalogSchema,
  type DevelopmentCampaignCatalog,
} from '../domain/development-campaigns/development-campaign.ts';
import {
  MissionCatalogSchema,
  type MissionCatalog,
} from '../domain/missions/mission.ts';

const EnvironmentSchema = z.object({
  HOST: z.enum(['127.0.0.1', '::1', 'localhost']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4310),
  VERA_MODEL_PROVIDER: z
    .enum(['ollama', 'openai', 'gemini', 'deterministic'])
    .default('ollama'),
  VERA_VISION_PROVIDER: z
    .enum(['ollama', 'openai', 'gemini', 'deterministic'])
    .optional(),
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().min(1).default('gemma4-12b-64k:latest'),
  OLLAMA_VISION_MODEL: z.string().min(1).default('qwen3-vl:8b'),
  OLLAMA_THINK: z
    .enum(['false', 'true', 'low', 'medium', 'high'])
    .default('false'),
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_MODEL: z.string().trim().min(1).default('gpt-5-mini'),
  OPENAI_VISION_MODEL: z.string().trim().min(1).default('gpt-5-mini'),
  GEMINI_BASE_URL: z
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
  GEMINI_VISION_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
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
  VERA_RESEARCH_ADAPTER: z
    .enum(['disabled', 'openai_web_search', 'deterministic_research'])
    .default('disabled'),
  RESEARCH_OPENAI_BASE_URL: z.url().optional(),
  RESEARCH_OPENAI_API_KEY: z.string().trim().min(1).optional(),
  RESEARCH_OPENAI_MODEL: z.string().trim().min(1).default('gpt-5.4-mini'),
  RESEARCH_SEARCH_CONTEXT_SIZE: z
    .enum(['low', 'medium', 'high'])
    .default('medium'),
  VERA_TRANSCRIPTION_PROVIDER: z
    .enum(['disabled', 'openai', 'whisper_cpp'])
    .default('disabled'),
  TRANSCRIPTION_OPENAI_BASE_URL: z.url().optional(),
  TRANSCRIPTION_OPENAI_API_KEY: z.string().trim().min(1).optional(),
  TRANSCRIPTION_OPENAI_MODEL: z
    .string()
    .trim()
    .min(1)
    .default('gpt-transcribe'),
  WHISPER_CPP_BASE_URL: z.url().default('http://127.0.0.1:8080'),
  WHISPER_CPP_MODEL: z.string().trim().min(1).default('whisper.cpp'),
  TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(120_000),
  TRANSCRIPTION_MAX_AUDIO_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(25_000_000)
    .default(25_000_000),
  CHANGE_APPLICATION_ROOT: z.string().min(1).optional(),
  GIT_COMMAND: z.string().min(1).default('git'),
  GH_COMMAND: z.string().min(1).default('gh'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(25).default(250),
  WORKER_LEASE_MS: z.coerce.number().int().min(1_000).default(900_000),
  VERA_OWNER_TIME_ZONE: z
    .string()
    .trim()
    .min(1)
    .default(Intl.DateTimeFormat().resolvedOptions().timeZone),
  REMINDER_WORKER_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(32)
    .default(2),
  REMINDER_POLL_INTERVAL_MS: z.coerce.number().int().min(25).default(500),
  REMINDER_LEASE_MS: z.coerce.number().int().min(1_000).default(30_000),
  VERA_PUSH_ADAPTER: z
    .enum(['disabled', 'expo', 'deterministic'])
    .default('disabled'),
  EXPO_PUSH_PROJECT_ID: z.string().trim().min(1).optional(),
  EXPO_PUSH_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  EXPO_PUSH_BASE_URL: z.url().default('https://exp.host'),
  PUSH_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(10_000),
  PUSH_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5_000),
  PUSH_RECEIPT_DELAY_MS: z.coerce.number().int().min(1_000).default(900_000),
  PUSH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  PUSH_LEASE_MS: z.coerce.number().int().min(10_000).default(60_000),
  VERA_MACHINE_CATALOG_FILE: z.string().trim().min(1).optional(),
  VERA_DEVELOPMENT_CAMPAIGN_CATALOG_FILE: z.string().trim().min(1).optional(),
  VERA_MISSION_CATALOG_FILE: z.string().trim().min(1).optional(),
});

function findRepositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8'),
      ) as { name?: unknown; workspaces?: unknown };
      if (
        packageJson.name === 'vera' &&
        Array.isArray(packageJson.workspaces)
      ) {
        return directory;
      }
    } catch {
      // Keep walking: most directories between this module and the repository
      // root do not contain a package manifest.
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('Could not locate the Vera repository root.');
    }
    directory = parent;
  }
}

const repositoryRoot = findRepositoryRoot();

export type AppConfig = {
  host: string;
  port: number;
  model: ModelConfig;
  vision?: ModelConfig;
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
  research: WebResearchAdapterConfig;
  transcription: SpeechTranscriptionConfig;
  application: {
    workspacesRoot: string;
  };
  publication: {
    adapterId: 'github_gh_cli';
    gitCommand: string;
    ghCommand: string;
  };
  worker: {
    concurrency: number;
    pollIntervalMs: number;
    leaseMs: number;
  };
  reminders: {
    ownerTimeZone: string;
    concurrency: number;
    pollIntervalMs: number;
    leaseMs: number;
  };
  push?: {
    provider: PushProviderConfig;
    pollIntervalMs: number;
    receiptDelayMs: number;
    maxAttempts: number;
    leaseMs: number;
  };
  machines?: MachineCatalog;
  developmentCampaigns?: DevelopmentCampaignCatalog;
  missions?: MissionCatalog;
};

function loadMachineCatalog(path: string | undefined): MachineCatalog {
  if (path === undefined) return { schemaVersion: 1, machines: [] };
  const absolutePath = resolve(repositoryRoot, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read VERA_MACHINE_CATALOG_FILE at ${absolutePath}.`,
      { cause: error },
    );
  }
  return MachineCatalogSchema.parse(parsed);
}

function loadDevelopmentCampaignCatalog(
  path: string | undefined,
): DevelopmentCampaignCatalog {
  if (path === undefined) return { schemaVersion: 1, policies: [] };
  const absolutePath = resolve(repositoryRoot, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read VERA_DEVELOPMENT_CAMPAIGN_CATALOG_FILE at ${absolutePath}.`,
      { cause: error },
    );
  }
  const catalog = DevelopmentCampaignCatalogSchema.parse(parsed);
  return {
    ...catalog,
    policies: catalog.policies.map((policy) => ({
      ...policy,
      projectRoot: realpathSync(resolve(repositoryRoot, policy.projectRoot)),
    })),
  };
}

function loadMissionCatalog(path: string | undefined): MissionCatalog {
  if (path === undefined) return { schemaVersion: 1, policies: [] };
  const absolutePath = resolve(repositoryRoot, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read VERA_MISSION_CATALOG_FILE at ${absolutePath}.`,
      { cause: error },
    );
  }
  return MissionCatalogSchema.parse(parsed);
}

function requireTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    throw new Error(
      `VERA_OWNER_TIME_ZONE "${value}" is not a valid IANA time zone.`,
    );
  }
}

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
        think:
          parsed.OLLAMA_THINK === 'false'
            ? false
            : parsed.OLLAMA_THINK === 'true'
              ? true
              : parsed.OLLAMA_THINK,
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

function createVisionModelConfig(
  parsed: z.infer<typeof EnvironmentSchema>,
): ModelConfig {
  const provider = parsed.VERA_VISION_PROVIDER ?? parsed.VERA_MODEL_PROVIDER;
  const shared = {
    timeoutMs: parsed.MODEL_TIMEOUT_MS,
    readinessTimeoutMs: parsed.MODEL_READINESS_TIMEOUT_MS,
    maxOutputTokens: parsed.MODEL_MAX_OUTPUT_TOKENS,
  };
  switch (provider) {
    case 'deterministic':
      return { provider: 'deterministic', model: 'deterministic-v1' };
    case 'ollama':
      return {
        provider: 'ollama',
        baseUrl: normalizeProviderBaseUrl('ollama', parsed.OLLAMA_BASE_URL),
        model: parsed.OLLAMA_VISION_MODEL,
        think:
          parsed.OLLAMA_THINK === 'false'
            ? false
            : parsed.OLLAMA_THINK === 'true'
              ? true
              : parsed.OLLAMA_THINK,
        ...shared,
      };
    case 'openai':
      return {
        provider: 'openai',
        baseUrl: normalizeProviderBaseUrl('openai', parsed.OPENAI_BASE_URL),
        apiKey: requireApiKey('openai', parsed.OPENAI_API_KEY),
        model: parsed.OPENAI_VISION_MODEL,
        ...shared,
      };
    case 'gemini':
      return {
        provider: 'gemini',
        baseUrl: normalizeProviderBaseUrl('gemini', parsed.GEMINI_BASE_URL),
        apiKey: requireApiKey('gemini', parsed.GEMINI_API_KEY),
        model: parsed.GEMINI_VISION_MODEL.replace(/^models\//u, ''),
        ...shared,
      };
  }
}

function createResearchConfig(
  parsed: z.infer<typeof EnvironmentSchema>,
): WebResearchAdapterConfig {
  if (parsed.VERA_RESEARCH_ADAPTER === 'disabled') {
    return { adapterId: 'disabled' };
  }
  if (parsed.VERA_RESEARCH_ADAPTER === 'deterministic_research') {
    return { adapterId: 'deterministic_research' };
  }
  const apiKey = parsed.RESEARCH_OPENAI_API_KEY ?? parsed.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error(
      'RESEARCH_OPENAI_API_KEY or OPENAI_API_KEY is required when VERA_RESEARCH_ADAPTER=openai_web_search.',
    );
  }
  return {
    adapterId: 'openai_web_search',
    openai: {
      baseUrl: normalizeProviderBaseUrl(
        'openai',
        parsed.RESEARCH_OPENAI_BASE_URL ?? parsed.OPENAI_BASE_URL,
      ),
      apiKey,
      model: parsed.RESEARCH_OPENAI_MODEL,
      timeoutMs: parsed.MODEL_TIMEOUT_MS,
      readinessTimeoutMs: parsed.MODEL_READINESS_TIMEOUT_MS,
      maxOutputTokens: parsed.MODEL_MAX_OUTPUT_TOKENS,
      searchContextSize: parsed.RESEARCH_SEARCH_CONTEXT_SIZE,
    },
  };
}

function createTranscriptionConfig(
  parsed: z.infer<typeof EnvironmentSchema>,
): SpeechTranscriptionConfig {
  const shared = { maxAudioBytes: parsed.TRANSCRIPTION_MAX_AUDIO_BYTES };
  if (parsed.VERA_TRANSCRIPTION_PROVIDER === 'disabled') {
    return { provider: 'disabled', ...shared };
  }
  if (parsed.VERA_TRANSCRIPTION_PROVIDER === 'whisper_cpp') {
    const baseUrl = normalizeProviderBaseUrl(
      'ollama',
      parsed.WHISPER_CPP_BASE_URL,
    );
    const url = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error(
        'WHISPER_CPP_BASE_URL must use a loopback host because this adapter is owner-controlled.',
      );
    }
    return {
      provider: 'whisper_cpp',
      baseUrl,
      model: parsed.WHISPER_CPP_MODEL,
      timeoutMs: parsed.TRANSCRIPTION_TIMEOUT_MS,
      ...shared,
    };
  }
  const apiKey = parsed.TRANSCRIPTION_OPENAI_API_KEY ?? parsed.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error(
      'TRANSCRIPTION_OPENAI_API_KEY or OPENAI_API_KEY is required when VERA_TRANSCRIPTION_PROVIDER=openai.',
    );
  }
  return {
    provider: 'openai',
    baseUrl: normalizeProviderBaseUrl(
      'openai',
      parsed.TRANSCRIPTION_OPENAI_BASE_URL ?? parsed.OPENAI_BASE_URL,
    ),
    apiKey,
    model: parsed.TRANSCRIPTION_OPENAI_MODEL,
    timeoutMs: parsed.TRANSCRIPTION_TIMEOUT_MS,
    ...shared,
  };
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);

  const changeCodexModel = parsed.CHANGE_CODEX_MODEL ?? parsed.CODEX_MODEL;
  const pushProvider: PushProviderConfig =
    parsed.VERA_PUSH_ADAPTER === 'disabled'
      ? { adapterId: 'disabled' }
      : parsed.VERA_PUSH_ADAPTER === 'deterministic'
        ? { adapterId: 'deterministic' }
        : {
            adapterId: 'expo',
            baseUrl: normalizePushBaseUrl(parsed.EXPO_PUSH_BASE_URL),
            projectId: requirePushProjectId(parsed.EXPO_PUSH_PROJECT_ID),
            timeoutMs: parsed.PUSH_TIMEOUT_MS,
            ...(parsed.EXPO_PUSH_ACCESS_TOKEN === undefined
              ? {}
              : { accessToken: parsed.EXPO_PUSH_ACCESS_TOKEN }),
          };

  return {
    host: parsed.HOST,
    port: parsed.PORT,
    model: createModelConfig(parsed),
    vision: createVisionModelConfig(parsed),
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
    research: createResearchConfig(parsed),
    transcription: createTranscriptionConfig(parsed),
    application: {
      workspacesRoot: resolve(
        parsed.CHANGE_APPLICATION_ROOT ??
          join(homedir(), '.vera', 'change-applications'),
      ),
    },
    publication: {
      adapterId: 'github_gh_cli',
      gitCommand: parsed.GIT_COMMAND,
      ghCommand: parsed.GH_COMMAND,
    },
    worker: {
      concurrency: parsed.WORKER_CONCURRENCY,
      pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
      leaseMs: parsed.WORKER_LEASE_MS,
    },
    reminders: {
      ownerTimeZone: requireTimeZone(parsed.VERA_OWNER_TIME_ZONE),
      concurrency: parsed.REMINDER_WORKER_CONCURRENCY,
      pollIntervalMs: parsed.REMINDER_POLL_INTERVAL_MS,
      leaseMs: parsed.REMINDER_LEASE_MS,
    },
    push: {
      provider: pushProvider,
      pollIntervalMs: parsed.PUSH_POLL_INTERVAL_MS,
      receiptDelayMs: parsed.PUSH_RECEIPT_DELAY_MS,
      maxAttempts: parsed.PUSH_MAX_ATTEMPTS,
      leaseMs: parsed.PUSH_LEASE_MS,
    },
    machines: loadMachineCatalog(parsed.VERA_MACHINE_CATALOG_FILE),
    developmentCampaigns: loadDevelopmentCampaignCatalog(
      parsed.VERA_DEVELOPMENT_CAMPAIGN_CATALOG_FILE,
    ),
    missions: loadMissionCatalog(parsed.VERA_MISSION_CATALOG_FILE),
  };
}

function requirePushProjectId(value: string | undefined): string {
  if (value === undefined)
    throw new Error(
      'EXPO_PUSH_PROJECT_ID is required when VERA_PUSH_ADAPTER=expo.',
    );
  return value;
}

function normalizePushBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      'EXPO_PUSH_BASE_URL must be a credential-free HTTPS origin.',
    );
  }
  return value.replace(/\/+$/u, '');
}
