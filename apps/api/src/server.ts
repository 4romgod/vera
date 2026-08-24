import { loadConfig } from './config.ts';
import { loadEnvironmentFile } from './environment.ts';
import { createApp } from './wiring.ts';

const environmentFile = loadEnvironmentFile();
const config = loadConfig();
const app = createApp(config);

app.log.info(
  {
    configuration: {
      environmentFileLoaded: environmentFile.loaded,
      host: config.host,
      port: config.port,
      modelProvider: config.modelProvider,
      ...(config.modelProvider === 'ollama'
        ? {
            ollama: {
              origin: new URL(config.ollama.baseUrl).origin,
              model: config.ollama.model,
              timeoutMs: config.ollama.timeoutMs,
              readinessTimeoutMs: config.ollama.readinessTimeoutMs,
            },
          }
        : {}),
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
