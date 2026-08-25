import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';

import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

import { VeraClient } from '../packages/client/dist/index.js';

const root = process.cwd();
const mongodbUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const database = `vera_verify_${randomUUID().replaceAll('-', '_')}`;
let runId;
let child;

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(typeof address === 'object' && address !== null);
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function startServer(port) {
  let output = '';
  const processHandle = spawn(process.execPath, ['apps/api/dist/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      MONGODB_URI: mongodbUri,
      MONGODB_DATABASE: database,
      REDIS_URL: redisUrl,
      VERA_STORAGE_MODE: 'persistent',
      VERA_MODEL_PROVIDER: 'deterministic',
      VERA_PLANNING_ADAPTER: 'structured_model',
      WORKER_POLL_INTERVAL_MS: '25',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  };
  processHandle.stdout.on('data', capture);
  processHandle.stderr.on('data', capture);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vera exited during startup.\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { processHandle, baseUrl };
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  processHandle.kill('SIGTERM');
  throw new Error(`Vera did not become healthy.\n${output}`);
}

async function stopServer() {
  if (child === undefined || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child?.kill('SIGKILL');
      reject(new Error('Vera did not stop cleanly.'));
    }, 10_000);
    child?.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child = undefined;
}

async function cleanup() {
  const mongo = new MongoClient(mongodbUri, {
    serverSelectionTimeoutMS: 3_000,
  });
  try {
    await mongo.connect();
    await mongo.db(database).dropDatabase();
  } finally {
    await mongo.close();
  }
  if (runId !== undefined) {
    const redis = createClient({
      url: redisUrl,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      await redis.del(`vera:v1:run:${runId}:scratchpad`);
    } finally {
      if (redis.isOpen) await redis.quit();
    }
  }
}

try {
  const port = await availablePort();
  let started = await startServer(port);
  child = started.processHandle;
  let client = new VeraClient({ baseUrl: started.baseUrl });
  const project = await client.registerProject({
    displayName: 'Vera persistent verification',
    rootPath: root,
    idempotencyKey: 'persistent-verification-project',
  });
  const submitted = await client.submitTask({
    message: 'Plan a documentation health-check command.',
    projectId: project.id,
    idempotencyKey: 'persistent-verification-task',
  });
  assert.equal(submitted.runStatus, 'deciding');
  runId = submitted.runId;
  const pending = await client.waitForRun(runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: 10_000,
  });
  assert.equal(pending.approval?.destination?.dataBoundary, 'owner_controlled');
  assert.equal(
    pending.approval?.proposedArguments.objective,
    'Plan a documentation health-check command.',
  );
  assert.ok(pending.approval);
  const accepted = await client.decideApproval(pending.approval.id, 'approved');
  assert.equal(accepted.runStatus, 'awaiting_approval');
  const completed = await client.waitForRun(runId, { timeoutMs: 10_000 });
  assert.equal(completed.runStatus, 'succeeded');
  assert.ok(completed.output?.artifact);
  const artifactId = completed.output.artifact.id;
  const artifact = await client.getArtifact(artifactId);
  const events = await client.getRunEvents(runId);
  assert.ok(events.events.some((event) => event.type === 'run_succeeded'));

  await stopServer();
  started = await startServer(port);
  child = started.processHandle;
  client = new VeraClient({ baseUrl: started.baseUrl });
  const recovered = await client.getRun(runId);
  assert.equal(recovered.runStatus, 'succeeded');
  assert.equal(recovered.output?.artifact?.id, artifactId);
  assert.equal((await client.getArtifact(artifactId)).sha256, artifact.sha256);

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'passed',
        database,
        taskId: recovered.taskId,
        runId,
        artifactId,
        eventCount: events.events.length,
        restartVerified: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await stopServer();
  await cleanup();
}
