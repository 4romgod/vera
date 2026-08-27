import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const command = process.env.WHISPER_CPP_COMMAND?.trim() || 'whisper-server';
const modelPath =
  process.env.WHISPER_CPP_MODEL_PATH?.trim() ||
  join(homedir(), '.vera', 'models', 'whisper', 'ggml-large-v3-turbo-q5_0.bin');
const endpoint = new URL(
  process.env.WHISPER_CPP_BASE_URL?.trim() || 'http://127.0.0.1:8080',
);

if (
  endpoint.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
  (endpoint.pathname !== '' && endpoint.pathname !== '/') ||
  endpoint.search !== '' ||
  endpoint.hash !== ''
) {
  throw new Error(
    'WHISPER_CPP_BASE_URL must be a plain loopback HTTP origin, for example http://127.0.0.1:8080.',
  );
}

await access(modelPath).catch(() => {
  throw new Error(
    `The whisper.cpp model does not exist at ${modelPath}. Set WHISPER_CPP_MODEL_PATH or install the documented local model.`,
  );
});

const child = spawn(
  command,
  [
    '--host',
    endpoint.hostname === '[::1]' ? '::1' : endpoint.hostname,
    '--port',
    endpoint.port || '8080',
    '--model',
    modelPath,
    '--language',
    'auto',
    '--convert',
    '--flash-attn',
  ],
  { stdio: 'inherit' },
);

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.once('SIGINT', () => forward('SIGINT'));
process.once('SIGTERM', () => forward('SIGTERM'));

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', (error) => {
    reject(
      new Error(
        `Could not start ${command}. Install whisper-cpp or set WHISPER_CPP_COMMAND.`,
        { cause: error },
      ),
    );
  });
  child.once('exit', (code, signal) => {
    if (signal !== null) resolve(128);
    else resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
