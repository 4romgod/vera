import { execFileSync, spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { loadEnvFile } from 'node:process';

import { environmentFiles } from './lib/vera-operations.mjs';

function fail(message) {
  throw new Error(message);
}

function argumentsForRuntime(argv) {
  let profile;
  let command;
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) fail(`Missing value for ${name ?? 'argument'}.`);
    if (name === '--profile') profile = value.trim().toLowerCase();
    else if (name === '--command') command = value;
    else fail(`Unknown LiveKit service argument: ${name}.`);
  }
  if (profile === undefined || !/^[a-z0-9][a-z0-9_-]*$/u.test(profile)) {
    fail('LiveKit service requires a safe --profile value.');
  }
  if (command === undefined || !isAbsolute(command)) {
    fail('LiveKit service requires an absolute --command path.');
  }
  return { profile, command };
}

function tailnetIp() {
  const value = execFileSync('tailscale', ['ip', '-4'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (
    !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/u.test(value)
  ) {
    fail('Tailscale did not return a private CGNAT IPv4 address.');
  }
  return value;
}

function credential(name, minimum) {
  const value = process.env[name]?.trim();
  if (
    value === undefined ||
    value.length < minimum ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    fail(`${name} is missing or unsafe.`);
  }
  return value;
}

const runtime = argumentsForRuntime(process.argv.slice(2));
const [profileFile, baseFile] = environmentFiles(runtime.profile);
loadEnvFile(profileFile);
loadEnvFile(baseFile);
if (process.env.VERA_LIVE_VOICE_ENABLED !== 'true') {
  fail('The LiveKit service may run only when VERA_LIVE_VOICE_ENABLED=true.');
}
const apiKey = credential('LIVEKIT_API_KEY', 3);
const apiSecret = credential('LIVEKIT_API_SECRET', 32);
const ip = tailnetIp();
const childEnvironment = Object.fromEntries(
  ['HOME', 'LANG', 'PATH', 'TMPDIR']
    .map((name) => [name, process.env[name]])
    .filter((entry) => entry[1] !== undefined),
);
process.stdout.write(
  `Starting Vera LiveKit on loopback and private tailnet address ${ip}.\n`,
);
const child = spawn(
  runtime.command,
  ['--bind', '127.0.0.1', '--bind', ip, '--node-ip', ip],
  {
    env: { ...childEnvironment, LIVEKIT_KEYS: `${apiKey}: ${apiSecret}\n` },
    stdio: 'inherit',
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) =>
  fail(`Could not start LiveKit. (${error.message})`),
);
child.once('exit', (code, signal) => {
  process.exitCode = signal === null ? (code ?? 1) : 1;
});
