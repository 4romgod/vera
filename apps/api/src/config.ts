import { z } from 'zod';

const EnvironmentSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4310),
  VERA_MODEL_PROVIDER: z.enum(['ollama', 'deterministic']).default('ollama'),
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().min(1).default('gemma4-12b-64k:latest'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(120_000),
  MODEL_READINESS_TIMEOUT_MS: z.coerce.number().int().min(250).default(3_000),
  VERA_STORAGE_MODE: z.enum(['persistent', 'memory']).default('persistent'),
  MONGODB_URI: z.url().default('mongodb://127.0.0.1:27017'),
  MONGODB_DATABASE: z.string().min(1).default('vera'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  SCRATCHPAD_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
  DEPENDENCY_TIMEOUT_MS: z.coerce.number().int().min(250).default(3_000),
});

export type AppConfig = {
  host: string;
  port: number;
  modelProvider: 'ollama' | 'deterministic';
  ollama: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
    readinessTimeoutMs: number;
  };
  storage: {
    mode: 'persistent' | 'memory';
    mongodbUri: string;
    mongodbDatabase: string;
    redisUrl: string;
    scratchpadTtlSeconds: number;
    dependencyTimeoutMs: number;
  };
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);

  return {
    host: parsed.HOST,
    port: parsed.PORT,
    modelProvider: parsed.VERA_MODEL_PROVIDER,
    ollama: {
      baseUrl: parsed.OLLAMA_BASE_URL.replace(/\/$/, ''),
      model: parsed.OLLAMA_MODEL,
      timeoutMs: parsed.MODEL_TIMEOUT_MS,
      readinessTimeoutMs: parsed.MODEL_READINESS_TIMEOUT_MS,
    },
    storage: {
      mode: parsed.VERA_STORAGE_MODE,
      mongodbUri: parsed.MONGODB_URI,
      mongodbDatabase: parsed.MONGODB_DATABASE,
      redisUrl: parsed.REDIS_URL,
      scratchpadTtlSeconds: parsed.SCRATCHPAD_TTL_SECONDS,
      dependencyTimeoutMs: parsed.DEPENDENCY_TIMEOUT_MS,
    },
  };
}
