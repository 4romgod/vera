import { loadConfig } from './config.ts';
import { loadEnvironmentFiles } from './environment.ts';
import { createApp } from './wiring.ts';
import { canonicalPlanningAdapterId } from './capabilities/development-planning-adapter-registry.ts';

const environmentFiles = loadEnvironmentFiles();
const config = loadConfig();
const app = createApp(config);

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
      worker: config.worker,
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
