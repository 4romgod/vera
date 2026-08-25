import type { FastifyServerOptions } from 'fastify';

export type RuntimeLoggerConfiguration = FastifyServerOptions['logger'];

export function createRuntimeLoggerConfiguration(
  options: {
    environment?: NodeJS.ProcessEnv;
    isTTY?: boolean;
  } = {},
): RuntimeLoggerConfiguration {
  const environment = options.environment ?? process.env;
  const configuredFormat = environment.VERA_LOG_FORMAT?.trim().toLowerCase();
  if (
    configuredFormat !== undefined &&
    configuredFormat !== 'json' &&
    configuredFormat !== 'pretty'
  ) {
    throw new Error('VERA_LOG_FORMAT must be json or pretty.');
  }

  const format =
    configuredFormat ??
    (environment.NODE_ENV === 'development' ? 'pretty' : 'json');
  const isTTY = options.isTTY ?? process.stdout.isTTY;
  if (format === 'json' || !isTTY) return true;

  return {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: environment.NO_COLOR === undefined,
        colorizeObjects: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    },
  };
}
