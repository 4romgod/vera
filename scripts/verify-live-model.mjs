import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';

import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

import { VeraClient } from '../packages/client/dist/index.js';

const root = process.cwd();
const profile = process.env.VERA_PROFILE?.trim();
if (!profile) {
  throw new Error(
    'VERA_PROFILE is required so live-model verification cannot accidentally select a provider.',
  );
}

const mongodbUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const database = `vera_live_verify_${randomUUID().replaceAll('-', '_')}`;
const operationTimeoutMs = positiveInteger(
  'VERA_LIVE_MODEL_TIMEOUT_MS',
  process.env.VERA_LIVE_MODEL_TIMEOUT_MS,
  240_000,
);
const runIds = new Set();
let child;
let serverOutput = '';

function positiveInteger(name, value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function scratchpadKey(runId) {
  return `vera:v1:run:${runId}:scratchpad`;
}

function rememberRun(task) {
  runIds.add(task.runId);
  return task;
}

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
  serverOutput = '';
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
      VERA_PROFILE: profile,
      VERA_PLANNING_ADAPTER: 'structured_model',
      VERA_CHANGE_ADAPTER: 'deterministic_change',
      VERA_RESEARCH_ADAPTER: 'deterministic_research',
      WORKER_CONCURRENCY: '2',
      WORKER_POLL_INTERVAL_MS: '25',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-30_000);
  };
  processHandle.stdout.on('data', capture);
  processHandle.stderr.on('data', capture);

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const startupDeadline = Date.now() + Math.min(operationTimeoutMs, 60_000);
  let lastReadiness;
  while (Date.now() < startupDeadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vera exited during startup.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ready`, {
        signal: AbortSignal.timeout(5_000),
      });
      const body = await response.json();
      lastReadiness = body;
      if (response.ok) return { processHandle, baseUrl, readiness: body };
    } catch {
      // The listener or one of its dependencies is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  processHandle.kill('SIGKILL');
  throw new Error(
    `Vera did not become ready.${
      lastReadiness === undefined
        ? ''
        : ` Last readiness response: ${JSON.stringify(lastReadiness)}`
    }\n${serverOutput}`,
  );
}

async function stopServer() {
  if (child === undefined || child.exitCode !== null) return;
  const processHandle = child;
  child = undefined;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processHandle.kill('SIGKILL');
      reject(new Error('Vera did not stop cleanly.'));
    }, 10_000);
    timer.unref();
    processHandle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    processHandle.kill('SIGTERM');
  });
}

function assertOrderedEvents(events) {
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_event, index) => index + 1),
  );
}

async function waitForApproval(client, runId, capability) {
  const task = await client.waitForRun(runId, {
    until: (candidate) =>
      candidate.runStatus === 'awaiting_approval' &&
      candidate.approval?.capability.name === capability,
    timeoutMs: operationTimeoutMs,
    intervalMs: 100,
  });
  assert.ok(task.approval);
  return task;
}

function generationEvidence(aggregates, provider, model) {
  const generations = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const durationMs = value.durationMs;
    const usage = value.usage;
    if (
      value.provider === provider &&
      value.model === model &&
      typeof durationMs === 'number' &&
      typeof usage === 'object' &&
      usage !== null &&
      typeof usage.inputTokens === 'number' &&
      typeof usage.outputTokens === 'number'
    ) {
      generations.push({
        provider: value.provider,
        model: value.model,
        durationMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      return;
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(aggregates);
  return {
    modelCalls: generations.length,
    generationDurationMs: generations.reduce(
      (total, generation) => total + generation.durationMs,
      0,
    ),
    inputTokens: generations.reduce(
      (total, generation) => total + generation.inputTokens,
      0,
    ),
    outputTokens: generations.reduce(
      (total, generation) => total + generation.outputTokens,
      0,
    ),
  };
}

async function verifyJourneys(mongo, baseUrl, readiness) {
  const startedAt = Date.now();
  const client = new VeraClient({ baseUrl });
  assert.notEqual(
    readiness.model.name,
    'deterministic',
    'Live-model verification requires a non-deterministic orchestration provider.',
  );

  const conversation = await client.createConversation({
    title: 'Live model qualification',
    idempotencyKey: 'live-model-conversation',
  });
  const direct = rememberRun(
    await client.appendMessage({
      conversationId: conversation.id,
      content: 'In one sentence, explain what an API is.',
      idempotencyKey: 'live-model-direct-response',
    }),
  );
  const directCompleted = await client.waitForRun(direct.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 100,
  });
  assert.equal(directCompleted.runStatus, 'succeeded');
  assert.equal(directCompleted.output?.kind, 'response');
  assert.equal(directCompleted.conversationReply?.status, 'projected');
  if (directCompleted.output?.kind !== 'response') {
    throw new Error('Live model direct-response journey returned no response.');
  }
  assert.ok(directCompleted.output.message.trim().length > 0);
  const projectedConversation = await client.getConversation(conversation.id);
  assert.deepEqual(
    projectedConversation.messages.map(({ role, taskId }) => ({
      role,
      taskId,
    })),
    [
      { role: 'owner', taskId: direct.taskId },
      { role: 'vera', taskId: direct.taskId },
    ],
  );

  const research = rememberRun(
    await client.submitTask({
      message:
        'Research the current OpenAI Responses API web-search contract and cite public sources.',
      idempotencyKey: 'live-model-research',
    }),
  );
  const researchApproval = await waitForApproval(
    client,
    research.runId,
    'web_research',
  );
  assert.equal(
    researchApproval.approval.destination?.adapterId,
    'deterministic_research',
  );
  await client.decideApproval(researchApproval.approval.id, 'approved');
  const researchCompleted = await client.waitForRun(research.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 100,
  });
  assert.equal(researchCompleted.runStatus, 'succeeded');
  assert.equal(researchCompleted.output?.kind, 'research_report');
  assert.ok(researchCompleted.output?.artifact);
  const researchArtifact = await client.getArtifact(
    researchCompleted.output.artifact.id,
  );
  assert.equal(researchArtifact.type, 'research_report');
  const researchEvents = await client.getRunEvents(research.runId);
  assertOrderedEvents(researchEvents.events);
  assert.ok(
    researchEvents.events.some((event) => event.type === 'approval_requested'),
  );
  assert.ok(
    researchEvents.events.some((event) => event.type === 'artifact_created'),
  );

  const adaptive = rememberRun(
    await client.submitTask({
      message:
        'Research whether deterministic verification evidence is available and if it is then remind me to review it at 2035-08-27T05:00:00.000Z',
      idempotencyKey: 'live-model-adaptive-goal',
    }),
  );
  const adaptiveResearchApproval = await waitForApproval(
    client,
    adaptive.runId,
    'web_research',
  );
  assert.equal(adaptiveResearchApproval.goal?.schemaVersion, 2);
  await client.decideApproval(adaptiveResearchApproval.approval.id, 'approved');
  const adaptiveReminderApproval = await waitForApproval(
    client,
    adaptive.runId,
    'personal_reminder_management',
  );
  assert.equal(
    adaptiveReminderApproval.approval.decisionEvidence?.[0]?.type,
    'research_report',
  );
  await client.decideApproval(adaptiveReminderApproval.approval.id, 'approved');
  const adaptiveCompleted = await client.waitForRun(adaptive.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 100,
  });
  assert.equal(adaptiveCompleted.runStatus, 'succeeded');
  assert.equal(adaptiveCompleted.goal?.status, 'succeeded');
  assert.equal(adaptiveCompleted.output?.kind, 'adaptive_goal_result');
  if (adaptiveCompleted.output?.kind !== 'adaptive_goal_result') {
    throw new Error('Live model adaptive journey returned no goal result.');
  }
  assert.equal(adaptiveCompleted.output.artifacts.length, 2);
  assert.equal(adaptiveCompleted.output.evidence.length, 2);
  assert.ok(
    (
      await client.listReminders({ status: 'scheduled', limit: 100 })
    ).reminders.some(
      (reminder) => reminder.scheduledFor === '2035-08-27T05:00:00.000Z',
    ),
  );

  const aggregates = await mongo
    .db(database)
    .collection('task_execution_aggregates')
    .find({})
    .toArray();
  const artifacts = await mongo
    .db(database)
    .collection('artifacts')
    .find({})
    .toArray();
  assert.equal(aggregates.length, 3);
  assert.equal(artifacts.length, 3);
  const generations = generationEvidence(
    aggregates,
    readiness.model.name,
    readiness.model.model,
  );
  const budgetedModelCalls = aggregates.reduce(
    (total, aggregate) =>
      total + (aggregate.run.budget?.consumed.modelCalls ?? 0),
    0,
  );
  assert.equal(generations.modelCalls, budgetedModelCalls);
  assert.ok(generations.modelCalls >= 5);

  return {
    durationMs: Date.now() - startedAt,
    provider: readiness.model.name,
    model: readiness.model.model,
    providerVersion: readiness.model.providerVersion,
    taskCount: aggregates.length,
    artifactCount: artifacts.length,
    eventCount: aggregates.reduce(
      (total, aggregate) => total + aggregate.events.length,
      0,
    ),
    ...generations,
    directConversationVerified: true,
    conversationProjectionVerified: true,
    approvalGatedResearchVerified: true,
    adaptiveGoalVerified: true,
    persistentStoresVerified: true,
  };
}

const mongo = new MongoClient(mongodbUri, {
  connectTimeoutMS: 3_000,
  serverSelectionTimeoutMS: 3_000,
  socketTimeoutMS: 3_000,
});
const redis = createClient({
  url: redisUrl,
  socket: { connectTimeout: 3_000, reconnectStrategy: false },
});
redis.on('error', () => undefined);

async function cleanup() {
  const errors = [];
  await stopServer().catch((error) => errors.push(error));
  try {
    const aggregates = await mongo
      .db(database)
      .collection('task_execution_aggregates')
      .find({}, { projection: { 'run.id': 1 } })
      .toArray();
    for (const aggregate of aggregates) {
      const runId = aggregate.run?.id;
      if (typeof runId === 'string') runIds.add(runId);
    }
  } catch (error) {
    errors.push(error);
  }
  if (redis.isOpen && runIds.size > 0) {
    await redis
      .del([...runIds].map((runId) => scratchpadKey(runId)))
      .catch((error) => errors.push(error));
  }
  if (redis.isOpen) {
    await redis.quit().catch((error) => errors.push(error));
  }
  await mongo
    .db(database)
    .dropDatabase()
    .catch((error) => errors.push(error));
  await mongo.close().catch((error) => errors.push(error));
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Live-model verification cleanup failed.');
  }
}

let evidence;
let verificationError;
try {
  await Promise.all([mongo.connect(), redis.connect()]);
  const port = await availablePort();
  const started = await startServer(port);
  child = started.processHandle;
  evidence = await verifyJourneys(mongo, started.baseUrl, started.readiness);
} catch (error) {
  verificationError = error;
  if (serverOutput.length > 0) {
    process.stderr.write(`Recent Vera output:\n${serverOutput}\n`);
  }
} finally {
  try {
    await cleanup();
  } catch (error) {
    if (verificationError === undefined) {
      verificationError = error;
    } else {
      process.stderr.write(
        `Cleanup also failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

if (verificationError !== undefined) throw verificationError;
assert.ok(evidence);
process.stdout.write(
  `${JSON.stringify(
    {
      status: 'passed',
      profile,
      database,
      planningAdapter: 'structured_model',
      researchAdapter: 'deterministic_research',
      externalModelDownloads: false,
      ...evidence,
    },
    null,
    2,
  )}\n`,
);
