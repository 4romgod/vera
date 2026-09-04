import { spawn, spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertInside,
  backupArchiveName,
  createLaunchAgentPlist,
  environmentFiles,
  executablePath,
  missingProductionArtifacts,
  parseArguments,
  redactCommandFailure,
  repositoryRoot,
  runtimePaths,
  serviceDefinitions,
} from './lib/vera-operations.mjs';

const usage = `Usage:
  node scripts/vera-service.mjs doctor [--profile <name>]
  node scripts/vera-service.mjs install [--profile <name>]
  node scripts/vera-service.mjs start [--profile <name>]
  node scripts/vera-service.mjs stop [--profile <name>]
  node scripts/vera-service.mjs restart [--profile <name>]
  node scripts/vera-service.mjs status [--profile <name>]
  node scripts/vera-service.mjs logs [--no-follow]
  node scripts/vera-service.mjs backup [--profile <name>]
  node scripts/vera-service.mjs backup-verify [--profile <name>]
  node scripts/vera-service.mjs update [--profile <name>]
  node scripts/vera-service.mjs uninstall [--profile <name>]
`;

function fail(message) {
  throw new Error(message);
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
  if (result.status !== 0) {
    fail(`${options.label ?? commandName} ${redactCommandFailure(result)}.`);
  }
  return result.stdout?.trim() ?? '';
}

function commandStatus(commandName, args, options = {}) {
  return spawnSync(commandName, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
}

function line(kind, label, detail) {
  const marker = kind === 'pass' ? '✓' : kind === 'warn' ? '!' : '✗';
  process.stdout.write(`${marker} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

function requireExecutable(name) {
  const path = executablePath(name);
  if (path === undefined) fail(`Required executable "${name}" is not in PATH.`);
  return path;
}

function loadSelectedEnvironment(profile) {
  const [profileFile, baseFile] = environmentFiles(profile);
  loadEnvFile(profileFile);
  loadEnvFile(baseFile);
}

function validateCompiledConfiguration(nodePath, profile) {
  const environmentModule = pathToFileURL(
    join(repositoryRoot, 'apps/api/dist/bootstrap/environment.js'),
  ).href;
  const configModule = pathToFileURL(
    join(repositoryRoot, 'apps/api/dist/bootstrap/config.js'),
  ).href;
  const source = `
    const environment = await import(${JSON.stringify(environmentModule)});
    const config = await import(${JSON.stringify(configModule)});
    environment.loadEnvironmentFiles();
    config.loadConfig();
  `;
  command(nodePath, ['--input-type=module', '--eval', source], {
    env: { ...process.env, VERA_PROFILE: profile },
    label: 'Compiled Vera configuration validation',
    timeoutMs: 10_000,
  });
}

async function doctor(profile, options = {}) {
  process.stdout.write(`Checking Vera production readiness (${profile})\n`);
  if (process.platform !== 'darwin') {
    fail('The current installer supports macOS launchd only.');
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    fail(`Node.js 22 or newer is required; found ${process.version}.`);
  }
  line('pass', 'Node.js', process.version);

  for (const path of environmentFiles(profile)) {
    const result = await stat(path).catch(() => undefined);
    if (result === undefined || !result.isFile()) {
      fail(`Required environment file is missing: ${path}`);
    }
    line('pass', 'Environment file', path.slice(repositoryRoot.length + 1));
  }
  loadSelectedEnvironment(profile);

  if ((process.env.VERA_STORAGE_MODE ?? 'persistent') !== 'persistent') {
    fail('The installed Vera service requires VERA_STORAGE_MODE=persistent.');
  }

  const nodePath = requireExecutable('node');
  const npmPath = requireExecutable('npm');
  const required = [
    'git',
    'mongosh',
    'mongodump',
    'mongorestore',
    'redis-cli',
    'codex',
    'gh',
    'tailscale',
    'launchctl',
  ];
  const usesOllama =
    process.env.VERA_MODEL_PROVIDER === 'ollama' ||
    (process.env.VERA_VISION_PROVIDER ?? process.env.VERA_MODEL_PROVIDER) ===
      'ollama';
  if (usesOllama) required.push('ollama');
  for (const executable of required) {
    line('pass', executable, requireExecutable(executable));
  }

  command(
    'mongosh',
    ['--quiet', '--eval', 'quit(db.runCommand({ping:1}).ok===1?0:1)'],
    {
      label: 'MongoDB readiness',
      timeoutMs: 10_000,
    },
  );
  line('pass', 'MongoDB', 'reachable');
  const redis = command('redis-cli', ['ping'], {
    label: 'Redis readiness',
    timeoutMs: 5_000,
  });
  if (redis !== 'PONG')
    fail('Redis returned an unexpected readiness response.');
  line('pass', 'Redis', 'reachable');
  if (usesOllama) {
    command('ollama', ['list'], {
      label: 'Ollama readiness',
      timeoutMs: 10_000,
    });
    line('pass', 'Ollama', 'reachable');
  }
  command('codex', ['login', 'status'], {
    label: 'Codex authentication',
    timeoutMs: 15_000,
  });
  line('pass', 'Codex', 'authenticated');
  command('gh', ['auth', 'status'], {
    label: 'GitHub authentication',
    timeoutMs: 15_000,
  });
  line('pass', 'GitHub CLI', 'authenticated');
  command('tailscale', ['status', '--peers=false'], {
    label: 'Tailscale readiness',
    timeoutMs: 10_000,
  });
  line('pass', 'Tailscale', 'connected');
  command('git', ['config', '--get', 'user.name'], {
    label: 'Git author name',
  });
  command('git', ['config', '--get', 'user.email'], {
    label: 'Git author email',
  });
  line('pass', 'Git author', 'configured');

  const missingArtifacts = missingProductionArtifacts();
  if (missingArtifacts.length > 0) {
    if (options.requireBuild) {
      fail(
        `Production output is missing: ${missingArtifacts
          .map((path) => path.slice(repositoryRoot.length + 1))
          .join(', ')}. Run npm run build:install first.`,
      );
    }
    line('warn', 'Production output', 'not built yet');
  } else {
    validateCompiledConfiguration(nodePath, profile);
    line('pass', 'Vera configuration', 'schema-valid');
  }
  return { nodePath, npmPath };
}

function launchDomain() {
  return `gui/${process.getuid()}`;
}

function serviceTarget(label) {
  return `${launchDomain()}/${label}`;
}

function isLoaded(label) {
  return (
    commandStatus('launchctl', ['print', serviceTarget(label)]).status === 0
  );
}

async function waitForServiceState(label, expectedLoaded, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isLoaded(label) === expectedLoaded) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  fail(
    `${label} did not become ${expectedLoaded ? 'loaded' : 'unloaded'} within ${timeoutMs}ms.`,
  );
}

async function bootout(definition) {
  if (!isLoaded(definition.label)) return;
  command('launchctl', ['bootout', serviceTarget(definition.label)], {
    label: `Unload ${definition.label}`,
  });
  await waitForServiceState(definition.label, false);
}

async function bootstrap(definition) {
  if (isLoaded(definition.label)) return;
  command('launchctl', ['bootstrap', launchDomain(), definition.path], {
    label: `Load ${definition.label}`,
  });
  await waitForServiceState(definition.label, true);
}

async function writeDefinition(definition) {
  const temporaryPath = `${definition.path}.tmp-${process.pid}`;
  await writeFile(
    temporaryPath,
    createLaunchAgentPlist(definition.configuration),
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(temporaryPath, definition.path);
}

async function waitForEndpoint(url, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json();
      if (response.ok && predicate(body)) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  }
  fail(
    `${url} did not become ready (${lastError instanceof Error ? lastError.message : String(lastError)}).`,
  );
}

async function install(profile) {
  const executables = await doctor(profile, { requireBuild: true });
  const paths = runtimePaths();
  await Promise.all([
    mkdir(paths.logsRoot, { recursive: true, mode: 0o700 }),
    mkdir(paths.backupsRoot, { recursive: true, mode: 0o700 }),
    mkdir(paths.launchAgentsRoot, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all(
    environmentFiles(profile).map((path) => chmod(path, 0o600)),
  );
  const definitions = serviceDefinitions({ ...executables, profile });
  for (const definition of definitions) {
    await bootout(definition);
    await writeDefinition(definition);
    await bootstrap(definition);
    line('pass', 'Installed service', definition.label);
  }
  await waitForEndpoint(
    'http://127.0.0.1:4310/ready',
    (body) => body?.status === 'ready',
    90_000,
  );
  await waitForEndpoint(
    'http://127.0.0.1:8081/_health',
    (body) => body?.status === 'ok' && body?.service === 'vera-frontend',
  );
  line('pass', 'Vera API', 'ready on loopback');
  line('pass', 'Vera frontend', 'ready on loopback');
}

async function requireInstalledDefinitions(profile) {
  const nodePath = requireExecutable('node');
  const npmPath = requireExecutable('npm');
  const definitions = serviceDefinitions({ nodePath, npmPath, profile });
  for (const definition of definitions) {
    const result = await stat(definition.path).catch(() => undefined);
    if (result === undefined) {
      fail(`${definition.label} is not installed. Run npm run vera:install.`);
    }
  }
  return definitions;
}

async function start(profile) {
  const definitions = await requireInstalledDefinitions(profile);
  for (const definition of definitions) await bootstrap(definition);
  await waitForEndpoint(
    'http://127.0.0.1:4310/ready',
    (body) => body?.status === 'ready',
    90_000,
  );
  await waitForEndpoint(
    'http://127.0.0.1:8081/_health',
    (body) => body?.status === 'ok',
  );
  line('pass', 'Vera', 'started and ready');
}

async function stop(profile, includeBackup = false) {
  const definitions = await requireInstalledDefinitions(profile);
  for (const definition of definitions) {
    if (!includeBackup && definition.name === 'backup') continue;
    await bootout(definition);
  }
  line('pass', 'Vera', 'stopped');
}

async function restart(profile) {
  await stop(profile);
  await start(profile);
}

async function endpointStatus(url, predicate) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    const body = await response.json();
    return response.ok && predicate(body) ? 'ready' : `HTTP ${response.status}`;
  } catch {
    return 'unreachable';
  }
}

async function status(profile) {
  const nodePath = requireExecutable('node');
  const npmPath = requireExecutable('npm');
  const definitions = serviceDefinitions({ nodePath, npmPath, profile });
  process.stdout.write('Vera service status\n');
  for (const definition of definitions) {
    line(
      isLoaded(definition.label) ? 'pass' : 'warn',
      definition.label,
      isLoaded(definition.label) ? 'loaded' : 'not loaded',
    );
  }
  const apiStatus = await endpointStatus(
    'http://127.0.0.1:4310/ready',
    (body) => body?.status === 'ready',
  );
  line(apiStatus === 'ready' ? 'pass' : 'warn', 'API endpoint', apiStatus);
  const frontendStatus = await endpointStatus(
    'http://127.0.0.1:8081/_health',
    (body) => body?.status === 'ok',
  );
  line(
    frontendStatus === 'ready' ? 'pass' : 'warn',
    'Frontend endpoint',
    frontendStatus,
  );
}

async function logs(follow) {
  const paths = runtimePaths();
  await mkdir(paths.logsRoot, { recursive: true, mode: 0o700 });
  const files = [
    join(paths.logsRoot, 'api.stdout.log'),
    join(paths.logsRoot, 'api.stderr.log'),
    join(paths.logsRoot, 'frontend.stdout.log'),
    join(paths.logsRoot, 'frontend.stderr.log'),
    join(paths.logsRoot, 'backup.stderr.log'),
  ];
  const args = ['-n', '120', ...(follow ? ['-f'] : []), ...files];
  const child = spawn('/usr/bin/tail', args, { stdio: 'inherit' });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

async function backup(profile) {
  loadSelectedEnvironment(profile);
  const paths = runtimePaths();
  await mkdir(paths.backupsRoot, { recursive: true, mode: 0o700 });
  const archive = assertInside(
    paths.backupsRoot,
    join(paths.backupsRoot, backupArchiveName()),
  );
  command(
    requireExecutable('mongodump'),
    [
      `--uri=${process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017'}`,
      `--db=${process.env.MONGODB_DATABASE ?? 'vera'}`,
      `--archive=${archive}`,
      '--gzip',
    ],
    { label: 'MongoDB backup', timeoutMs: 30 * 60_000 },
  );
  await chmod(archive, 0o600);

  const retentionDays = Number(process.env.VERA_BACKUP_RETENTION_DAYS ?? '14');
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 365
  ) {
    fail('VERA_BACKUP_RETENTION_DAYS must be between 1 and 365.');
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
  for (const name of await readdir(paths.backupsRoot)) {
    if (!/^vera-\d{4}-\d{2}-\d{2}T.+\.archive\.gz$/u.test(name)) continue;
    const path = assertInside(paths.backupsRoot, join(paths.backupsRoot, name));
    const metadata = await stat(path);
    if (metadata.mtimeMs < cutoff) await unlink(path);
  }
  line('pass', 'MongoDB backup', archive);
}

async function latestBackupArchive() {
  const { backupsRoot } = runtimePaths();
  const candidates = await Promise.all(
    (await readdir(backupsRoot))
      .filter((name) => /^vera-\d{4}-\d{2}-\d{2}T.+\.archive\.gz$/u.test(name))
      .map(async (name) => {
        const path = assertInside(backupsRoot, join(backupsRoot, name));
        return { path, metadata: await stat(path) };
      }),
  );
  candidates.sort(
    (left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs,
  );
  if (candidates[0] === undefined) {
    fail('No Vera MongoDB backup exists. Run npm run vera:backup first.');
  }
  return candidates[0].path;
}

async function verifyBackup(profile) {
  loadSelectedEnvironment(profile);
  const archive = await latestBackupArchive();
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  const sourceDatabase = process.env.MONGODB_DATABASE ?? 'vera';
  const verificationDatabase = `vera_backup_verify_${Date.now()}`;
  if (!/^vera_backup_verify_\d+$/u.test(verificationDatabase)) {
    fail('Refusing to use an unsafe backup-verification database name.');
  }
  const dropVerificationDatabase = () =>
    commandStatus(
      requireExecutable('mongosh'),
      [
        uri,
        '--quiet',
        '--eval',
        `db.getSiblingDB(${JSON.stringify(verificationDatabase)}).dropDatabase()`,
      ],
      { timeoutMs: 30_000 },
    );
  dropVerificationDatabase();
  try {
    command(
      requireExecutable('mongorestore'),
      [
        `--uri=${uri}`,
        `--archive=${archive}`,
        '--gzip',
        `--nsFrom=${sourceDatabase}.*`,
        `--nsTo=${verificationDatabase}.*`,
      ],
      { label: 'MongoDB backup restore verification', timeoutMs: 30 * 60_000 },
    );
    const collectionCount = Number(
      command(
        requireExecutable('mongosh'),
        [
          uri,
          '--quiet',
          '--eval',
          `db.getSiblingDB(${JSON.stringify(verificationDatabase)}).getCollectionNames().length`,
        ],
        { label: 'Restored backup inspection', timeoutMs: 30_000 },
      ),
    );
    if (!Number.isInteger(collectionCount) || collectionCount < 1) {
      fail('The restored backup did not contain any MongoDB collections.');
    }
    line(
      'pass',
      'MongoDB backup restore',
      `${collectionCount} collections recovered from ${archive}`,
    );
  } finally {
    dropVerificationDatabase();
  }
}

function requireCleanMain() {
  if (command('git', ['branch', '--show-current']) !== 'main') {
    fail('Vera updates require the production checkout to be on main.');
  }
  if (command('git', ['status', '--porcelain']).length > 0) {
    fail('Vera updates require a clean production checkout.');
  }
}

async function update(profile) {
  requireCleanMain();
  await doctor(profile);
  command('git', ['fetch', 'origin', 'main'], { label: 'Fetch origin/main' });
  const local = command('git', ['rev-parse', 'HEAD']);
  const remote = command('git', ['rev-parse', 'origin/main']);
  command('git', ['merge-base', '--is-ancestor', local, remote], {
    label: 'Fast-forward safety check',
  });
  if (local === remote) {
    line('pass', 'Update', 'already on origin/main');
    return;
  }
  const paths = runtimePaths();
  const stagingRoot = assertInside(
    paths.stateRoot,
    join(paths.stateRoot, 'update-staging'),
  );
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(paths.stateRoot, { recursive: true, mode: 0o700 });
  try {
    command('git', ['worktree', 'add', '--detach', stagingRoot, remote], {
      label: 'Create update verification worktree',
    });
    command(requireExecutable('npm'), ['ci'], {
      cwd: stagingRoot,
      label: 'Install candidate dependencies',
      timeoutMs: 15 * 60_000,
      inherit: true,
    });
    command(requireExecutable('npm'), ['run', 'check'], {
      cwd: stagingRoot,
      label: 'Verify candidate',
      timeoutMs: 30 * 60_000,
      inherit: true,
    });
    command(requireExecutable('npm'), ['run', 'build:install'], {
      cwd: stagingRoot,
      label: 'Build candidate',
      timeoutMs: 30 * 60_000,
      inherit: true,
    });
  } finally {
    commandStatus('git', ['worktree', 'remove', '--force', stagingRoot]);
    await rm(stagingRoot, { recursive: true, force: true });
  }
  command('git', ['merge', '--ff-only', 'origin/main'], {
    label: 'Fast-forward main',
    inherit: true,
  });
  command(requireExecutable('npm'), ['ci'], {
    label: 'Install production dependencies',
    timeoutMs: 15 * 60_000,
    inherit: true,
  });
  command(requireExecutable('npm'), ['run', 'build:install'], {
    label: 'Build production runtime',
    timeoutMs: 30 * 60_000,
    inherit: true,
  });
  await restart(profile);
  line('pass', 'Update', `${local.slice(0, 7)} → ${remote.slice(0, 7)}`);
}

async function uninstall(profile) {
  const nodePath = requireExecutable('node');
  const npmPath = requireExecutable('npm');
  const definitions = serviceDefinitions({ nodePath, npmPath, profile });
  for (const definition of definitions) {
    await bootout(definition);
    await unlink(definition.path).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  line(
    'pass',
    'Vera services',
    'removed; databases, backups, environment files, and source were preserved',
  );
}

async function main() {
  const { action, profile, follow } = parseArguments(process.argv.slice(2));
  switch (action) {
    case 'doctor':
      await doctor(profile);
      break;
    case 'install':
      await install(profile);
      break;
    case 'start':
      await start(profile);
      break;
    case 'stop':
      await stop(profile);
      break;
    case 'restart':
      await restart(profile);
      break;
    case 'status':
      await status(profile);
      break;
    case 'logs':
      await logs(follow);
      break;
    case 'backup':
      await backup(profile);
      break;
    case 'backup-verify':
      await verifyBackup(profile);
      break;
    case 'update':
      await update(profile);
      break;
    case 'uninstall':
      await uninstall(profile);
      break;
    default:
      fail(usage);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
