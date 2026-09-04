import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const VERA_API_PATH = '/api';
const VERA_API_TARGET = 'http://127.0.0.1:4310';
const VERA_FRONTEND_TARGET = 'http://localhost:8081';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function tailscaleJson(args) {
  try {
    return JSON.parse(
      execFileSync('tailscale', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    fail(
      `Unable to read Tailscale state. Confirm that Tailscale is installed, connected, and available in PATH. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function tailnetEndpoint() {
  const status = tailscaleJson(['status', '--json']);
  if (status.BackendState !== 'Running' || status.Self?.Online !== true) {
    fail('Tailscale must be connected on the Vera host.');
  }
  const dnsName = status.Self.DNSName?.replace(/\.$/u, '');
  if (dnsName === undefined || dnsName.length === 0) {
    fail('Tailscale did not report a MagicDNS name for the Vera host.');
  }
  return { dnsName, apiUrl: `https://${dnsName}` };
}

function isEmptyConfiguration(configuration) {
  return Object.keys(configuration).length === 0;
}

function webHandlers(configuration) {
  if (typeof configuration.Web !== 'object' || configuration.Web === null) {
    return [];
  }
  const httpsServers = Object.entries(configuration.Web).filter(([name]) =>
    name.endsWith(':443'),
  );
  if (httpsServers.length !== 1) return [];
  const server = httpsServers[0][1];
  if (
    typeof server !== 'object' ||
    server === null ||
    typeof server.Handlers !== 'object' ||
    server.Handlers === null
  ) {
    return [];
  }
  return Object.entries(server.Handlers);
}

function handlerTargets(configuration) {
  return new Map(
    webHandlers(configuration).map(([path, handler]) => [
      path,
      typeof handler === 'object' &&
      handler !== null &&
      typeof handler.Proxy === 'string'
        ? handler.Proxy
        : undefined,
    ]),
  );
}

function isPhoneConfiguration(configuration) {
  const handlers = handlerTargets(configuration);
  return (
    handlers.get('/') === VERA_FRONTEND_TARGET &&
    handlers.get(VERA_API_PATH) === VERA_API_TARGET
  );
}

function runTailscale(args) {
  const result = spawnSync('tailscale', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`Tailscale command failed: tailscale ${args.join(' ')}`);
  }
}

function configurePhoneServe() {
  const serve = tailscaleJson(['serve', 'status', '--json']);
  if (isPhoneConfiguration(serve)) return;
  const handlers = handlerTargets(serve);
  const conflictingPath = [
    ['/', VERA_FRONTEND_TARGET],
    [VERA_API_PATH, VERA_API_TARGET],
  ].find(([path, expected]) => {
    const actual = handlers.get(path);
    return actual !== undefined && actual !== expected;
  });
  if (conflictingPath !== undefined) {
    fail(
      `Tailscale Serve path ${conflictingPath[0]} already targets ${handlers.get(conflictingPath[0])}. Refusing to overwrite it.`,
    );
  }
  if (handlers.get(VERA_API_PATH) !== VERA_API_TARGET) {
    runTailscale([
      'serve',
      '--bg',
      `--set-path=${VERA_API_PATH}`,
      VERA_API_TARGET,
    ]);
  }
  if (handlers.get('/') !== VERA_FRONTEND_TARGET) {
    runTailscale(['serve', '--bg', VERA_FRONTEND_TARGET]);
  }
  if (!isPhoneConfiguration(tailscaleJson(['serve', 'status', '--json']))) {
    fail("Tailscale Serve did not retain Vera's expected phone routes.");
  }
}

async function verifyVeraEndpoint(apiUrl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`health check returned HTTP ${response.status}`);
      }
      const body = await response.json();
      if (body?.status !== 'ok' || body?.service !== 'vera-api') {
        throw new Error('health check returned an unexpected response');
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(1_000);
      }
    }
  }
  fail(
    `Vera is not reachable through Tailscale Serve. Confirm that the API is running, then retry. (${lastError instanceof Error ? lastError.message : String(lastError)})`,
  );
}

function run(command, args, environment = process.env) {
  const child = spawn(command, args, {
    env: environment,
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
  child.once('error', (error) => fail(error.message));
  child.once('exit', (code, signal) => {
    process.exitCode = signal === null ? (code ?? 1) : 1;
  });
}

const action = process.argv[2];

switch (action) {
  case 'frontend': {
    const current = tailnetEndpoint();
    configurePhoneServe();
    const apiUrl = `${current.apiUrl}${VERA_API_PATH}`;
    await verifyVeraEndpoint(apiUrl);
    process.stdout.write(
      `Starting Vera's private web frontend at ${current.apiUrl} with API ${apiUrl}.\n`,
    );
    run(
      'npm',
      [
        'run',
        'dev:web',
        '--workspace',
        '@vera/frontend',
        '--',
        '--host',
        'localhost',
      ],
      { ...process.env, EXPO_PUBLIC_VERA_API_URL: apiUrl },
    );
    break;
  }
  case 'serve': {
    tailnetEndpoint();
    configurePhoneServe();
    process.stdout.write(
      'Vera phone routes are available through Tailscale Serve.\n',
    );
    break;
  }
  case 'off': {
    const serve = tailscaleJson(['serve', 'status', '--json']);
    const handlers = handlerTargets(serve);
    const managedPaths = [
      ['/', VERA_FRONTEND_TARGET],
      [VERA_API_PATH, VERA_API_TARGET],
    ].filter(([path, target]) => handlers.get(path) === target);
    if (managedPaths.length === 0 || isEmptyConfiguration(serve)) {
      process.stdout.write('Tailscale Serve is already disabled.\n');
      break;
    }
    for (const [path] of managedPaths) {
      runTailscale(['serve', '--https=443', `--set-path=${path}`, 'off']);
    }
    process.stdout.write(
      'Removed Vera paths without changing unrelated Tailscale Serve routes.\n',
    );
    break;
  }
  case 'status': {
    const current = tailnetEndpoint();
    process.stdout.write(
      `${JSON.stringify(
        {
          frontendUrl: current.apiUrl,
          apiUrl: `${current.apiUrl}${VERA_API_PATH}`,
          serve: tailscaleJson(['serve', 'status', '--json']),
        },
        null,
        2,
      )}\n`,
    );
    break;
  }
  default:
    fail(
      'Usage: node scripts/tailscale-development.mjs <frontend|serve|off|status>',
    );
}
