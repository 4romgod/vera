import { canonicalPlanningAdapterId } from '../adapters/outbound/capabilities/development-planning/development-planning-adapter-registry.ts';
import { loadConfig } from './config.ts';
import { loadEnvironmentFiles } from './environment.ts';
import { createRuntimeLoggerConfiguration } from './logging.ts';
import { createApp } from './wiring.ts';

const environmentFiles = loadEnvironmentFiles();
const config = loadConfig();
const app = createApp(config, {
  logger: createRuntimeLoggerConfiguration(),
});

const remoteModelConfiguration =
  config.model.provider === 'deterministic'
    ? {}
    : {
        origin: new URL(config.model.baseUrl).origin,
        timeoutMs: config.model.timeoutMs,
        readinessTimeoutMs: config.model.readinessTimeoutMs,
        maxOutputTokens: config.model.maxOutputTokens,
      };

app.log.info(
  {
    configuration: {
      environment: {
        profile: environmentFiles.profile ?? 'default',
        baseFileLoaded: environmentFiles.baseFile.loaded,
        profileFileLoaded: environmentFiles.profileFile?.loaded ?? false,
      },
      host: config.host,
      port: config.port,
      model: {
        provider: config.model.provider,
        model: config.model.model,
        ...(config.model.provider === 'ollama'
          ? { think: config.model.think }
          : {}),
        dataBoundary:
          config.model.provider === 'ollama' ||
          config.model.provider === 'deterministic'
            ? 'owner_controlled'
            : 'third_party',
        ...remoteModelConfiguration,
      },
      planning: {
        configuredAdapterId: config.planning.adapterId,
        resolvedAdapterId: canonicalPlanningAdapterId(
          config.planning.adapterId,
        ),
        ...(canonicalPlanningAdapterId(config.planning.adapterId) ===
        'codex_cli'
          ? {
              model:
                config.planning.adapters.codexCli.model ?? 'configured-default',
            }
          : {}),
      },
      publication: {
        adapterId: config.publication.adapterId,
        gitCommand: config.publication.gitCommand,
        ghCommand: config.publication.ghCommand,
      },
      research:
        config.research.adapterId === 'openai_web_search'
          ? {
              adapterId: config.research.adapterId,
              provider: 'openai',
              model: config.research.openai.model,
              origin: new URL(config.research.openai.baseUrl).origin,
              searchContextSize: config.research.openai.searchContextSize,
            }
          : { adapterId: config.research.adapterId },
      transcription: {
        provider: config.transcription.provider,
        model:
          config.transcription.provider === 'disabled'
            ? 'none'
            : config.transcription.model,
        dataBoundary:
          config.transcription.provider === 'openai'
            ? 'third_party'
            : 'owner_controlled',
        maxAudioBytes: config.transcription.maxAudioBytes,
        ...(config.transcription.provider === 'disabled'
          ? {}
          : {
              origin: new URL(config.transcription.baseUrl).origin,
              timeoutMs: config.transcription.timeoutMs,
            }),
      },
      worker: config.worker,
      reminders: config.reminders,
      storage: {
        mode: config.storage.mode,
        ...(config.storage.mode === 'persistent'
          ? {
              mongodb: {
                host: new URL(config.storage.mongodbUri).host,
                database: config.storage.mongodbDatabase,
              },
              redis: { host: new URL(config.storage.redisUrl).host },
              scratchpadTtlSeconds: config.storage.scratchpadTtlSeconds,
              dependencyTimeoutMs: config.storage.dependencyTimeoutMs,
            }
          : {}),
      },
    },
  },
  'Runtime configuration loaded',
);

async function shutDown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
}

process.once('SIGINT', () => {
  void shutDown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutDown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
