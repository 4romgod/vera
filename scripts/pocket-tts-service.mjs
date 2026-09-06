import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  environmentFiles,
  executablePath,
  repositoryRoot,
} from './lib/vera-operations.mjs';

function fail(message) {
  throw new Error(message);
}

function parseRuntime(argv) {
  let profile = process.env.VERA_PROFILE?.trim().toLowerCase() || 'ollama';
  let command;
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) fail(`Missing value for ${name ?? 'argument'}.`);
    if (name === '--profile') profile = value.trim().toLowerCase();
    else if (name === '--command') command = value;
    else fail(`Unknown Pocket TTS service argument: ${name}.`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(profile)) {
    fail('Pocket TTS service requires a safe profile value.');
  }
  const resolvedCommand = command ?? executablePath('uv');
  if (resolvedCommand === undefined || !isAbsolute(resolvedCommand)) {
    fail(
      'Pocket TTS service requires uv in PATH or an absolute --command path.',
    );
  }
  return { profile, command: resolvedCommand };
}

function loopbackEndpoint(value) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    (endpoint.pathname !== '' && endpoint.pathname !== '/') ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    fail('POCKET_TTS_BASE_URL must be a plain loopback HTTP origin.');
  }
  return endpoint;
}

const runtime = parseRuntime(process.argv.slice(2));
const [profileFile, baseFile] = environmentFiles(runtime.profile);
loadEnvFile(profileFile);
loadEnvFile(baseFile);
if (process.env.VERA_SPEECH_PROVIDER !== 'pocket_tts') {
  fail('Pocket TTS may run only when VERA_SPEECH_PROVIDER=pocket_tts.');
}
const endpoint = loopbackEndpoint(
  process.env.POCKET_TTS_BASE_URL ?? 'http://127.0.0.1:8091',
);
const voice = process.env.POCKET_TTS_VOICE?.trim() || 'alba';
if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(voice)) fail('Unsafe Pocket TTS voice.');
const voices = [
  ...new Set(
    (process.env.POCKET_TTS_ALLOWED_VOICES ?? 'alba,anna')
      .split(',')
      .map((candidate) => candidate.trim())
      .filter(Boolean),
  ),
];
if (
  voices.length === 0 ||
  voices.some((candidate) => !/^[a-z][a-z0-9_-]{0,63}$/u.test(candidate))
) {
  fail(
    'POCKET_TTS_ALLOWED_VOICES must be a comma-separated list of safe voices.',
  );
}
if (!voices.includes(voice)) {
  fail('POCKET_TTS_ALLOWED_VOICES must include POCKET_TTS_VOICE.');
}

const childEnvironment = Object.fromEntries(
  ['HOME', 'LANG', 'PATH', 'TMPDIR', 'HF_HOME']
    .map((name) => [name, process.env[name]])
    .filter((entry) => entry[1] !== undefined),
);
childEnvironment.POCKET_TTS_ALLOWED_VOICES = voices.join(',');
const child = spawn(
  runtime.command,
  [
    'run',
    '--directory',
    join(repositoryRoot, 'services', 'pocket-tts'),
    '--frozen',
    '--extra',
    'engine',
    '--no-sync',
    'vera-pocket-tts',
    '--host',
    endpoint.hostname === '[::1]' ? '::1' : endpoint.hostname,
    '--port',
    endpoint.port || '8091',
  ],
  { env: childEnvironment, stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) =>
  fail(`Could not start Pocket TTS. (${error.message})`),
);
child.once('exit', (code, signal) => {
  process.exitCode = signal === null ? (code ?? 1) : 1;
});
