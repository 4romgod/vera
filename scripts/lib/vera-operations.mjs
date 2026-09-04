import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
);

export const serviceLabels = Object.freeze({
  api: 'dev.vera.api',
  frontend: 'dev.vera.frontend',
  backup: 'dev.vera.backup',
});

export function runtimePaths(options = {}) {
  const ownerHome = options.ownerHome ?? homedir();
  const stateRoot = resolve(ownerHome, '.vera');
  return {
    stateRoot,
    logsRoot: join(stateRoot, 'logs'),
    backupsRoot: join(stateRoot, 'backups', 'mongodb'),
    launchAgentsRoot: join(ownerHome, 'Library', 'LaunchAgents'),
  };
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function plistValue(value, indent) {
  const padding = ' '.repeat(indent);
  if (typeof value === 'boolean') {
    return `${padding}<${value ? 'true' : 'false'}/>`;
  }
  if (typeof value === 'number') {
    return `${padding}<integer>${value}</integer>`;
  }
  if (Array.isArray(value)) {
    return [
      `${padding}<array>`,
      ...value.map((entry) => plistValue(entry, indent + 2)),
      `${padding}</array>`,
    ].join('\n');
  }
  if (value !== null && typeof value === 'object') {
    return [
      `${padding}<dict>`,
      ...Object.entries(value).flatMap(([key, entry]) => [
        `${' '.repeat(indent + 2)}<key>${xmlEscape(key)}</key>`,
        plistValue(entry, indent + 2),
      ]),
      `${padding}</dict>`,
    ].join('\n');
  }
  return `${padding}<string>${xmlEscape(value)}</string>`;
}

export function createLaunchAgentPlist(configuration) {
  const body = Object.entries(configuration).flatMap(([key, value]) => [
    `  <key>${xmlEscape(key)}</key>`,
    plistValue(value, 2),
  ]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...body,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function executablePath(command, environment = process.env) {
  const result = spawnSync('/usr/bin/which', [command], {
    encoding: 'utf8',
    env: environment,
  });
  if (result.status !== 0) return undefined;
  const candidate = result.stdout.trim();
  // Preserve the executable's operator-facing shim directory in PATH. Tools
  // installed by mise, npm, Homebrew, and app bundles often resolve to an
  // internal script whose directory does not contain their sibling commands.
  return candidate.length === 0 ? undefined : resolve(candidate);
}

export function productionPath(nodePath, npmPath) {
  return [
    dirname(nodePath),
    dirname(npmPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
    .filter((entry, index, values) => values.indexOf(entry) === index)
    .join(':');
}

export function serviceDefinitions(options) {
  const paths = runtimePaths({ ownerHome: options.ownerHome });
  const sharedEnvironment = {
    PATH: productionPath(options.nodePath, options.npmPath),
  };
  return [
    {
      name: 'api',
      label: serviceLabels.api,
      path: join(paths.launchAgentsRoot, `${serviceLabels.api}.plist`),
      configuration: {
        Label: serviceLabels.api,
        ProgramArguments: [
          options.nodePath,
          join(repositoryRoot, 'apps', 'api', 'dist', 'server.js'),
        ],
        WorkingDirectory: repositoryRoot,
        EnvironmentVariables: {
          ...sharedEnvironment,
          NODE_ENV: 'production',
          VERA_LOG_FORMAT: 'json',
          VERA_PROFILE: options.profile,
        },
        RunAtLoad: true,
        KeepAlive: true,
        ThrottleInterval: 10,
        ProcessType: 'Background',
        StandardOutPath: join(paths.logsRoot, 'api.stdout.log'),
        StandardErrorPath: join(paths.logsRoot, 'api.stderr.log'),
      },
    },
    {
      name: 'frontend',
      label: serviceLabels.frontend,
      path: join(paths.launchAgentsRoot, `${serviceLabels.frontend}.plist`),
      configuration: {
        Label: serviceLabels.frontend,
        ProgramArguments: [
          options.nodePath,
          join(repositoryRoot, 'scripts', 'static-frontend.mjs'),
        ],
        WorkingDirectory: repositoryRoot,
        EnvironmentVariables: {
          ...sharedEnvironment,
          VERA_FRONTEND_HOST: '127.0.0.1',
          VERA_FRONTEND_PORT: '8081',
        },
        RunAtLoad: true,
        KeepAlive: true,
        ThrottleInterval: 10,
        ProcessType: 'Background',
        StandardOutPath: join(paths.logsRoot, 'frontend.stdout.log'),
        StandardErrorPath: join(paths.logsRoot, 'frontend.stderr.log'),
      },
    },
    {
      name: 'backup',
      label: serviceLabels.backup,
      path: join(paths.launchAgentsRoot, `${serviceLabels.backup}.plist`),
      configuration: {
        Label: serviceLabels.backup,
        ProgramArguments: [
          options.nodePath,
          join(repositoryRoot, 'scripts', 'vera-service.mjs'),
          'backup',
          '--profile',
          options.profile,
        ],
        WorkingDirectory: repositoryRoot,
        EnvironmentVariables: sharedEnvironment,
        StartCalendarInterval: { Hour: 3, Minute: 15 },
        ProcessType: 'Background',
        StandardOutPath: join(paths.logsRoot, 'backup.stdout.log'),
        StandardErrorPath: join(paths.logsRoot, 'backup.stderr.log'),
      },
    },
  ];
}

export function assertInside(parent, candidate) {
  const absoluteParent = resolve(parent);
  const absoluteCandidate = resolve(candidate);
  if (
    absoluteCandidate === absoluteParent ||
    !absoluteCandidate.startsWith(`${absoluteParent}${sep}`)
  ) {
    throw new Error(`Refusing to operate outside ${absoluteParent}.`);
  }
  return absoluteCandidate;
}

export function backupArchiveName(now = new Date()) {
  const timestamp = now.toISOString().replaceAll(':', '-');
  return `vera-${timestamp}.archive.gz`;
}

export function environmentFiles(profile) {
  return [
    join(repositoryRoot, `.env.${profile}`),
    join(repositoryRoot, '.env'),
  ];
}

export function missingProductionArtifacts() {
  return [
    join(repositoryRoot, 'apps', 'api', 'dist', 'server.js'),
    join(repositoryRoot, 'apps', 'frontend', 'dist-host', 'index.html'),
  ].filter((path) => !existsSync(path));
}

export function parseArguments(argv) {
  const [action, ...rest] = argv;
  let profile = process.env.VERA_PROFILE?.trim().toLowerCase() || 'ollama';
  let follow = true;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--profile') {
      const candidate = rest[index + 1]?.trim().toLowerCase();
      if (
        candidate === undefined ||
        !/^[a-z0-9][a-z0-9_-]*$/u.test(candidate)
      ) {
        throw new Error('--profile requires a safe profile name.');
      }
      profile = candidate;
      index += 1;
    } else if (value === '--no-follow') {
      follow = false;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return { action, profile, follow };
}

export function redactCommandFailure(result) {
  const message = result.error?.message?.trim();
  if (message) return message;
  return `exited with status ${result.status ?? 'unknown'}`;
}
