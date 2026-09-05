import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';

import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

import { MongoDbWorkLeaseStore } from '../apps/api/dist/adapters/outbound/persistence/mongodb/mongodb-work-lease-store.js';
import { MongoDbProjectMutationLeaseStore } from '../apps/api/dist/adapters/outbound/persistence/mongodb/mongodb-project-mutation-lease-store.js';
import { MongoDbIntegrationConnectionStore } from '../apps/api/dist/adapters/outbound/persistence/mongodb/mongodb-integration-connection-store.js';
import { MongoDbExternalSignalStore } from '../apps/api/dist/adapters/outbound/persistence/mongodb/mongodb-external-signal-store.js';
import { VeraClient } from '../packages/client/dist/index.js';

const executeFile = promisify(execFile);
const root = process.cwd();
const mongodbUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const database = `vera_verify_${randomUUID().replaceAll('-', '_')}`;
const changeApplicationRoot = join(tmpdir(), `${database}_applications`);
// A hosted runner can spend one full dependency timeout falling back from the
// rebuildable Redis projection to MongoDB. Leave enough budget for that
// fallback plus the next poll without relaxing the workflow-level time bound.
const operationTimeoutMs = 30_000;
// Persistent startup creates or validates every MongoDB collection and index.
// Cold hosted infrastructure can take longer than the ordinary local path, so
// readiness receives the same finite operational budget as later HTTP work.
const startupTimeoutMs = 30_000;
const runIds = new Set();
const temporaryDirectories = new Set([changeApplicationRoot]);
let child;
let serverOutput = '';
let machineCatalogFile;

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
      VERA_MODEL_PROVIDER: 'deterministic',
      VERA_PLANNING_ADAPTER: 'structured_model',
      VERA_CHANGE_ADAPTER: 'deterministic_change',
      VERA_RESEARCH_ADAPTER: 'deterministic_research',
      CHANGE_APPLICATION_ROOT: changeApplicationRoot,
      WORKER_CONCURRENCY: '2',
      WORKER_POLL_INTERVAL_MS: '25',
      VERA_OWNER_TIME_ZONE: 'Africa/Johannesburg',
      REMINDER_WORKER_CONCURRENCY: '2',
      REMINDER_POLL_INTERVAL_MS: '25',
      REMINDER_LEASE_MS: '1000',
      VERA_PUSH_ADAPTER: 'deterministic',
      PUSH_POLL_INTERVAL_MS: '250',
      PUSH_RECEIPT_DELAY_MS: '1000',
      ...(machineCatalogFile === undefined
        ? {}
        : { VERA_MACHINE_CATALOG_FILE: machineCatalogFile }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-20_000);
  };
  processHandle.stdout.on('data', capture);
  processHandle.stderr.on('data', capture);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const startupDeadline = Date.now() + startupTimeoutMs;
  while (Date.now() < startupDeadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vera exited during startup.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ready`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return { processHandle, baseUrl };
    } catch {
      // The listener or its dependencies are not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  processHandle.kill('SIGKILL');
  throw new Error(`Vera did not become ready.\n${serverOutput}`);
}

async function createGitFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vera-verify-project-'));
  temporaryDirectories.add(projectRoot);
  await executeFile('git', ['init', '--quiet'], { cwd: projectRoot });
  await writeFile(
    join(projectRoot, 'README.md'),
    '# Persistent verification fixture\n',
    'utf8',
  );
  await executeFile('git', ['add', 'README.md'], { cwd: projectRoot });
  await executeFile(
    'git',
    [
      '-c',
      'user.name=Vera Verification',
      '-c',
      'user.email=vera@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'verification fixture',
    ],
    { cwd: projectRoot },
  );
  return projectRoot;
}

async function createMachineCatalogFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vera-machine-verify-'));
  temporaryDirectories.add(directory);
  const path = join(directory, 'machines.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      machines: [
        {
          id: 'verification-machine',
          displayName: 'Verification machine',
          adapter: { kind: 'local' },
          diagnostics: [
            {
              id: 'node-runtime',
              label: 'Node runtime',
              command: {
                executable: process.execPath,
                arguments: ['--version'],
                timeoutMs: 2_000,
              },
            },
          ],
          services: [],
        },
      ],
    }),
    'utf8',
  );
  return path;
}

async function stopServer() {
  if (child === undefined || child.exitCode !== null) return;
  const processHandle = child;
  child = undefined;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processHandle.kill('SIGKILL');
      reject(new Error('Vera did not stop cleanly.'));
    }, operationTimeoutMs);
    timer.unref();
    processHandle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    processHandle.kill('SIGTERM');
  });
}

async function crashServer() {
  if (child === undefined || child.exitCode !== null) return;
  const processHandle = child;
  child = undefined;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Vera did not terminate after SIGKILL.')),
      operationTimeoutMs,
    );
    timer.unref();
    processHandle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    processHandle.kill('SIGKILL');
  });
}

async function waitForLeaseRelease(mongo, runId) {
  const leases = mongo.db(database).collection('run_work_leases');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await leases.countDocuments({ _id: runId })) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Worker lease for ${runId} was not released.`);
}

function assertOrderedEvents(events) {
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_event, index) => index + 1),
  );
}

async function verifyLeaseExclusion() {
  const first = new MongoDbWorkLeaseStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  const second = new MongoDbWorkLeaseStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  const runId = `run_lease_${randomUUID()}`;
  const acquiredAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    const claims = await Promise.all([
      first.claim(
        {
          schemaVersion: 1,
          runId,
          workerId: 'verification_worker_first',
          token: 'verification_token_first',
          acquiredAt,
          expiresAt,
        },
        acquiredAt,
      ),
      second.claim(
        {
          schemaVersion: 1,
          runId,
          workerId: 'verification_worker_second',
          token: 'verification_token_second',
          acquiredAt,
          expiresAt,
        },
        acquiredAt,
      ),
    ]);
    assert.deepEqual(claims.toSorted(), [false, true]);
  } finally {
    await Promise.allSettled([
      first.release(runId, 'verification_token_first'),
      second.release(runId, 'verification_token_second'),
    ]);
    await Promise.allSettled([first.close(), second.close()]);
  }
}

async function verifyProjectMutationLeaseExclusion() {
  const first = new MongoDbProjectMutationLeaseStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  const second = new MongoDbProjectMutationLeaseStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  const projectId = `project_lease_${randomUUID()}`;
  const acquiredAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  try {
    const claims = await Promise.all([
      first.claim(
        {
          schemaVersion: 1,
          projectId,
          workerId: 'verification_application_worker_first',
          token: 'verification_application_token_first',
          acquiredAt,
          expiresAt,
        },
        acquiredAt,
      ),
      second.claim(
        {
          schemaVersion: 1,
          projectId,
          workerId: 'verification_application_worker_second',
          token: 'verification_application_token_second',
          acquiredAt,
          expiresAt,
        },
        acquiredAt,
      ),
    ]);
    assert.deepEqual(claims.toSorted(), [false, true]);
  } finally {
    await Promise.allSettled([
      first.release(projectId, 'verification_application_token_first'),
      second.release(projectId, 'verification_application_token_second'),
    ]);
    await Promise.allSettled([first.close(), second.close()]);
  }
}

async function verifyIntegrationConnectionPersistence() {
  const first = new MongoDbIntegrationConnectionStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  const now = new Date().toISOString();
  const id = `connection_${randomUUID()}`;
  const record = {
    schemaVersion: 1,
    version: 1,
    id,
    requestKey: 'persistent-verification-github-connection',
    principalId: 'owner_v1',
    integrationId: 'github',
    adapterId: 'github_gh_cli',
    status: 'active',
    credentialBinding: { kind: 'host_session', host: 'github.com' },
    account: { providerAccountId: '123', login: 'persistent-fixture' },
    operations: ['issues_read', 'issues_create'],
    lastVerifiedAt: now,
    events: [
      {
        schemaVersion: 1,
        id: `event_${randomUUID()}`,
        sequence: 1,
        type: 'connection_enabled',
        occurredAt: now,
        data: {},
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  try {
    const created = await first.create(record);
    assert.equal(created.created, true);
    assert.equal((await first.create(record)).created, false);
  } finally {
    await first.close();
  }

  const recovered = new MongoDbIntegrationConnectionStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  try {
    const value = await recovered.findById('owner_v1', id);
    assert.equal(value?.account.login, 'persistent-fixture');
    assert.equal(await recovered.findById('another_owner', id), null);
    assert.equal((await recovered.list('owner_v1')).length, 1);
  } finally {
    await recovered.close();
  }
}

async function verifyExternalSignalPersistence() {
  const first = new MongoDbExternalSignalStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  const id = `external_signal_${randomUUID()}`;
  const signal = {
    schemaVersion: 1,
    version: 1,
    id,
    principalId: 'owner_v1',
    routineId: 'routine_persistent_watch',
    integrationId: 'github',
    connectionId: 'connection_persistent_watch',
    project: { id: 'project_persistent_watch', displayName: 'Vera' },
    repository: { provider: 'github', owner: '4romgod', name: 'vera' },
    externalKey: 'pull:42:failed-checks',
    category: 'failed_check',
    title: 'Checks failed on #42',
    summary: 'quality-gate failed.',
    url: 'https://github.com/4romgod/vera/pull/42',
    occurredAt: '2026-09-05T10:00:00.000Z',
    status: 'active',
    firstObservedAt: '2026-09-05T10:01:00.000Z',
    lastObservedAt: '2026-09-05T10:01:00.000Z',
  };
  try {
    assert.equal((await first.upsert(signal)).created, true);
    assert.equal((await first.upsert(signal)).created, false);
  } finally {
    await first.close();
  }
  const recovered = new MongoDbExternalSignalStore({
    uri: mongodbUri,
    database,
    timeoutMs: 3_000,
  });
  try {
    assert.equal((await recovered.listActive('owner_v1', 10))[0]?.id, id);
    assert.equal(
      (await recovered.listNotifications('owner_v1', { limit: 10 }))[0]?.id,
      `notification_${id.slice('external_signal_'.length)}`,
    );
    assert.equal(
      await recovered.resolveMissing({
        principalId: 'owner_v1',
        routineId: signal.routineId,
        activeIds: [],
        resolvedAt: '2026-09-05T10:02:00.000Z',
      }),
      1,
    );
    assert.equal((await recovered.listActive('owner_v1', 10)).length, 0);
  } finally {
    await recovered.close();
  }
}

async function verifyCliJourney(
  baseUrl,
  changeProjectId,
  changeProjectRoot,
  client,
  personalTaskId,
  reminderId,
  memoryId,
) {
  const catalog = await client.listCapabilities();
  const researchCapability = catalog.capabilities.find(
    (capability) => capability.name === 'web_research',
  );
  assert.equal(researchCapability?.enabled, true);
  assert.equal(
    researchCapability?.destination?.adapterId,
    'deterministic_research',
  );
  assert.equal(researchCapability?.authority.projectContext, 'none');

  const capabilityResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'capability',
      'show',
      'web_research',
      '--url',
      baseUrl,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(capabilityResult.stdout, /"enabled": true/u);
  assert.match(capabilityResult.stdout, /"projectContext": "none"/u);

  const planResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'plan',
      '--url',
      baseUrl,
      '--project',
      changeProjectId,
      '--message',
      'Plan a deterministic CLI verification change.',
      '--key',
      'persistent-verification-cli-plan',
      '--approve',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(planResult.stdout, /"contextManifest"/u);
  assert.match(planResult.stdout, /"runStatus": "succeeded"/u);
  assert.match(planResult.stdout, /"type": "implementation_plan"/u);

  const researchResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'research',
      '--url',
      baseUrl,
      '--message',
      'Research deterministic durable execution evidence.',
      '--key',
      'persistent-verification-cli-research',
      '--approve',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(researchResult.stdout, /"runStatus": "succeeded"/u);
  assert.match(researchResult.stdout, /"type": "research_report"/u);
  assert.match(researchResult.stdout, /"projectContext": "none"/u);
  assert.match(
    researchResult.stdout,
    /https:\/\/example\.com\/vera\/research-fixture/u,
  );
  const researchArtifactIds = [
    ...researchResult.stdout.matchAll(/"id": "(artifact_[^"]+)"/gu),
  ].map((match) => match[1]);
  const researchArtifactId = researchArtifactIds.at(-1);
  assert.ok(researchArtifactId);
  const researchArtifact = await client.getArtifact(researchArtifactId);
  assert.equal(researchArtifact.type, 'research_report');
  assert.equal(researchArtifact.projectId, undefined);

  const personalTasksResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'personal-task',
      'list',
      '--url',
      baseUrl,
      '--status',
      'completed',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(personalTasksResult.stdout, new RegExp(personalTaskId, 'u'));
  assert.match(personalTasksResult.stdout, /"status": "completed"/u);

  const remindersResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'reminder',
      'list',
      '--url',
      baseUrl,
      '--status',
      'acknowledged',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(remindersResult.stdout, new RegExp(reminderId, 'u'));
  assert.match(remindersResult.stdout, /"status": "acknowledged"/u);

  const notificationsResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'notification',
      'list',
      '--url',
      baseUrl,
      '--limit',
      '10',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(notificationsResult.stdout, new RegExp(reminderId, 'u'));
  assert.match(notificationsResult.stdout, /"channel": "vera_inbox"/u);

  const memoriesResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'memory',
      'list',
      '--url',
      baseUrl,
      '--status',
      'all',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(memoriesResult.stdout, new RegExp(memoryId, 'u'));
  assert.match(memoriesResult.stdout, /"revision": 2/u);
  assert.match(memoriesResult.stdout, /"status": "forgotten"/u);

  const changeResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'change',
      '--url',
      baseUrl,
      '--project',
      changeProjectId,
      '--message',
      'Implement a deterministic CLI verification marker.',
      '--key',
      'persistent-verification-cli-change',
      '--approve',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(changeResult.stdout, /"runStatus": "succeeded"/u);
  assert.match(changeResult.stdout, /"type": "software_change"/u);
  assert.match(changeResult.stdout, /VERA_DETERMINISTIC_CHANGE\.md/u);
  assert.match(changeResult.stdout, /new file mode 100644/u);

  const artifactIds = [
    ...changeResult.stdout.matchAll(/"id": "(artifact_[^"]+)"/gu),
  ].map((match) => match[1]);
  const changeArtifactId = artifactIds.at(-1);
  assert.ok(changeArtifactId);
  const applicationResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'change',
      'apply',
      '--url',
      baseUrl,
      '--artifact',
      changeArtifactId,
      '--key',
      'persistent-verification-cli-application',
      '--approve',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(applicationResult.stdout, /"status": "succeeded"/u);
  assert.match(applicationResult.stdout, /"staged": true/u);
  assert.match(applicationResult.stdout, /"branchName": "vera\/change-/u);
  const applicationIds = [
    ...applicationResult.stdout.matchAll(/"id": "(application_[^"]+)"/gu),
  ].map((match) => match[1]);
  const applicationId = applicationIds.at(-1);
  assert.ok(applicationId);
  const application = await client.getChangeApplication(applicationId);
  assert.equal(application.status, 'succeeded');
  assert.ok(application.result);
  const canonicalApplicationRoot = await realpath(changeApplicationRoot);
  assert.ok(
    application.result.workspacePath.startsWith(
      `${canonicalApplicationRoot}${sep}`,
    ),
  );
  assert.equal(
    await readFile(
      join(application.result.workspacePath, 'VERA_DETERMINISTIC_CHANGE.md'),
      'utf8',
    ).then((value) => value.length > 0),
    true,
  );
  assert.equal(
    (
      await executeFile(
        'git',
        ['status', '--porcelain', '--untracked-files=no'],
        { cwd: changeProjectRoot },
      )
    ).stdout,
    '',
  );
  const replayedApplication = await client.createChangeApplication({
    artifactId: changeArtifactId,
    idempotencyKey: 'persistent-verification-cli-application',
  });
  assert.equal(replayedApplication.id, application.id);
  const applicationEvents = await client.getChangeApplicationEvents(
    application.id,
  );
  assertOrderedEvents(applicationEvents.events);
  assert.equal(
    applicationEvents.events.filter(
      (event) => event.type === 'change_application_succeeded',
    ).length,
    1,
  );

  const chatResult = await executeFile(
    process.execPath,
    [
      'apps/cli/dist/bin.js',
      'chat',
      '--url',
      baseUrl,
      '--message',
      'Explain the deterministic CLI chat path.',
      '--key',
      'persistent-verification-cli-chat',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: operationTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.match(chatResult.stdout, /"runStatus": "succeeded"/u);
  assert.match(chatResult.stdout, /"role": "vera"/u);
  assert.match(chatResult.stdout, /"conversationId": "conversation_/u);

  for (const match of `${planResult.stdout}\n${researchResult.stdout}\n${changeResult.stdout}\n${chatResult.stdout}`.matchAll(
    /"runId": "([^"]+)"/gu,
  )) {
    const runId = match[1];
    if (runId !== undefined) runIds.add(runId);
  }
  return { applicationId: application.id, researchArtifactId };
}

async function verifyScenarios(mongo, redis) {
  const startedAt = Date.now();
  machineCatalogFile = await createMachineCatalogFixture();
  const port = await availablePort();
  let started = await startServer(port);
  child = started.processHandle;
  let client = new VeraClient({ baseUrl: started.baseUrl });

  const pushStatus = await client.getPushNotificationStatus();
  assert.equal(pushStatus.enabled, true);
  assert.equal(pushStatus.provider, 'deterministic');
  assert.equal(pushStatus.projectId, 'deterministic-project');
  const notificationDevice = await client.registerNotificationDevice({
    installationId: 'persistent-verification-device',
    provider: 'expo',
    projectId: 'deterministic-project',
    pushToken: 'ExpoPushToken[persistent-private-token]',
    platform: 'android',
    name: 'Persistent verification device',
  });
  const pushDelivery = await client.testNotificationDevice(
    notificationDevice.id,
    'persistent-verification-push',
  );
  assert.equal(
    (
      await client.testNotificationDevice(
        notificationDevice.id,
        'persistent-verification-push',
      )
    ).id,
    pushDelivery.id,
  );
  let deliveredPush;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    deliveredPush = (await client.listPushDeliveries()).deliveries.find(
      (candidate) => candidate.id === pushDelivery.id,
    );
    if (deliveredPush?.status === 'delivered') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(deliveredPush?.status, 'delivered');
  assert.equal(JSON.stringify(deliveredPush).includes('ticket'), false);
  assert.equal(
    JSON.stringify(await client.listNotificationDevices()).includes(
      'persistent-private-token',
    ),
    false,
  );
  assert.equal(
    (await client.revokeNotificationDevice(notificationDevice.id)).status,
    'revoked',
  );

  const routineInput = {
    title: 'Persistent verification health check',
    schedule: {
      kind: 'daily',
      timeZone: 'Africa/Johannesburg',
      localTime: '08:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    },
    action: {
      kind: 'machine_health_check',
      machineId: 'verification-machine',
    },
    idempotencyKey: 'persistent-verification-routine',
  };
  const routine = await client.createRoutine(routineInput);
  assert.equal((await client.createRoutine(routineInput)).id, routine.id);
  assert.equal(routine.status, 'awaiting_approval');
  const approvedRoutine = await client.decideRoutine({
    routineId: routine.id,
    decision: 'approved',
  });
  assert.equal(approvedRoutine.status, 'active');
  const routineRun = await client.runRoutineNow({
    routineId: routine.id,
    idempotencyKey: 'persistent-verification-routine-run',
  });
  const completedRoutineRun = await client.waitForRoutineRun(routineRun.id, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(completedRoutineRun.status, 'succeeded');
  assert.equal(completedRoutineRun.result?.outcome, 'healthy');

  const knowledgeAttachment = await client.uploadAttachment({
    filename: 'persistent-knowledge.txt',
    mediaType: 'text/plain',
    bytes: new Blob([
      'Project Polaris uses the amber readiness checklist. Its accountable owner is Mira.',
    ]),
  });
  const knowledgeInput = {
    title: 'Persistent Polaris source',
    scope: { kind: 'global' },
    attachmentIds: [knowledgeAttachment.id],
    idempotencyKey: 'persistent-verification-knowledge',
  };
  const knowledgeSource = await client.createKnowledgeSource(knowledgeInput);
  assert.equal(
    (await client.createKnowledgeSource(knowledgeInput)).id,
    knowledgeSource.id,
  );

  const projectInput = {
    displayName: 'Vera persistent verification',
    rootPath: root,
    idempotencyKey: 'persistent-verification-project',
  };
  const project = await client.registerProject(projectInput);
  assert.equal((await client.registerProject(projectInput)).id, project.id);
  const changeProjectRoot = await createGitFixture();
  const changeProject = await client.registerProject({
    displayName: 'Vera change-application verification',
    rootPath: changeProjectRoot,
    idempotencyKey: 'persistent-verification-change-project',
  });

  const conversationInput = {
    title: 'Persistent verification',
    idempotencyKey: 'persistent-verification-conversation',
  };
  const conversation = await client.createConversation(conversationInput);
  assert.equal(
    (await client.createConversation(conversationInput)).id,
    conversation.id,
  );

  const messageInput = {
    conversationId: conversation.id,
    content: 'Plan a documentation validation command.',
    projectId: project.id,
    idempotencyKey: 'persistent-verification-message',
  };
  const submitted = rememberRun(await client.appendMessage(messageInput));
  assert.equal(submitted.runStatus, 'deciding');
  assert.equal(submitted.conversationId, conversation.id);
  let pending = await client.waitForRun(submitted.runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(pending.approval?.destination?.dataBoundary, 'owner_controlled');
  assert.equal(pending.approval?.destination?.adapterId, 'structured_model');
  assert.equal(
    pending.approval?.proposedArguments.objective,
    messageInput.content,
  );
  assert.ok(pending.approval?.contextManifest?.totalFiles > 0);
  assert.ok(pending.approval);

  const collidingOwnerMessage = rememberRun(
    await client.appendMessage({
      conversationId: conversation.id,
      content: 'Explain why idempotency namespaces matter.',
      projectId: project.id,
      idempotencyKey: `vera-reply:${submitted.taskId}`,
    }),
  );
  const collidingOwnerCompleted = await client.waitForRun(
    collidingOwnerMessage.runId,
    {
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.equal(collidingOwnerCompleted.runStatus, 'succeeded');
  assert.equal(collidingOwnerCompleted.conversationReply?.status, 'projected');

  await waitForLeaseRelease(mongo, submitted.runId);
  await crashServer();
  started = await startServer(port);
  child = started.processHandle;
  client = new VeraClient({ baseUrl: started.baseUrl });
  assert.equal(
    (await client.listPushDeliveries()).deliveries.find(
      (candidate) => candidate.id === pushDelivery.id,
    )?.status,
    'delivered',
  );
  assert.equal(
    (await client.listNotificationDevices()).devices[0]?.id,
    notificationDevice.id,
  );
  assert.equal(
    (await client.listNotificationDevices()).devices[0]?.status,
    'revoked',
  );
  assert.equal((await client.listRoutines()).routines[0]?.id, routine.id);
  assert.equal((await client.getRoutineRun(routineRun.id)).status, 'succeeded');
  assert.equal(
    (await client.getKnowledgeSource(knowledgeSource.id)).id,
    knowledgeSource.id,
  );
  const persistedKnowledge = await client.searchKnowledge({
    query: 'Who owns Project Polaris?',
  });
  assert.equal(persistedKnowledge.citations[0]?.sourceId, knowledgeSource.id);
  assert.match(persistedKnowledge.citations[0]?.excerpt ?? '', /Mira/u);
  const pendingAfterCrash = await client.getRun(submitted.runId);
  assert.equal(pendingAfterCrash.runStatus, 'awaiting_approval');
  assert.equal(pendingAfterCrash.approval?.id, pending.approval.id);
  assert.deepEqual(
    pendingAfterCrash.approval?.contextManifest,
    pending.approval.contextManifest,
  );
  pending = pendingAfterCrash;

  const duplicateApprovals = await Promise.all([
    client.decideApproval(pending.approval.id, 'approved'),
    client.decideApproval(pending.approval.id, 'approved'),
  ]);
  assert.ok(
    duplicateApprovals.every((task) => task.approval?.status === 'approved'),
  );
  const completed = await client.waitForRun(submitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(completed.runStatus, 'succeeded');
  assert.ok(completed.output?.artifact);
  const artifact = await client.getArtifact(completed.output.artifact.id);
  const events = await client.getRunEvents(submitted.runId);
  assertOrderedEvents(events.events);
  assert.equal(
    events.events.filter((event) => event.type === 'artifact_created').length,
    1,
  );
  assert.equal(
    events.events.filter(
      (event) => event.type === 'capability_invocation_started',
    ).length,
    1,
  );

  const replayed = await client.appendMessage(messageInput);
  assert.equal(replayed.taskId, completed.taskId);
  assert.equal(replayed.runId, completed.runId);
  assert.equal(replayed.output?.artifact?.id, artifact.id);

  const followup = rememberRun(
    await client.appendMessage({
      conversationId: conversation.id,
      content: 'What did Vera just produce?',
      projectId: project.id,
      idempotencyKey: 'persistent-verification-followup',
    }),
  );
  const followupCompleted = await client.waitForRun(followup.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(followupCompleted.runStatus, 'succeeded');
  assert.equal(followupCompleted.conversationReply?.status, 'projected');
  assert.equal(followupCompleted.conversationContextManifest?.totalMessages, 4);
  assert.deepEqual(
    followupCompleted.conversationContextManifest?.entries.map(
      ({ role, taskId }) => ({ role, taskId }),
    ),
    [
      { role: 'owner', taskId: submitted.taskId },
      { role: 'vera', taskId: submitted.taskId },
      { role: 'owner', taskId: collidingOwnerCompleted.taskId },
      { role: 'vera', taskId: collidingOwnerCompleted.taskId },
    ],
  );

  assert.equal(await redis.del(scratchpadKey(submitted.runId)), 1);
  await client.getRun(submitted.runId);
  const repairedPayload = await redis.hGet(
    scratchpadKey(submitted.runId),
    'payload',
  );
  assert.ok(repairedPayload);
  const repaired = JSON.parse(repairedPayload);
  assert.equal(repaired.runId, submitted.runId);
  assert.equal(repaired.status, 'succeeded');

  const direct = rememberRun(
    await client.submitTask({
      message: 'Explain what Vera does.',
      idempotencyKey: 'persistent-verification-direct',
    }),
  );
  const directCompleted = await client.waitForRun(direct.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(directCompleted.runStatus, 'succeeded');
  assert.equal(directCompleted.output?.kind, 'response');
  assert.equal(directCompleted.approval, undefined);

  const rejected = rememberRun(
    await client.submitTask({
      message: 'Plan a rejected verification change.',
      projectId: project.id,
      idempotencyKey: 'persistent-verification-rejected',
    }),
  );
  const rejectionPending = await client.waitForRun(rejected.runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.ok(rejectionPending.approval);
  const rejection = await client.decideApproval(
    rejectionPending.approval.id,
    'rejected',
  );
  assert.equal(rejection.runStatus, 'rejected');
  assert.equal(
    (await client.decideApproval(rejectionPending.approval.id, 'rejected'))
      .runId,
    rejected.runId,
  );
  const rejectionEvents = await client.getRunEvents(rejected.runId);
  assert.equal(
    rejectionEvents.events.filter((event) => event.type === 'approval_rejected')
      .length,
    1,
  );
  assert.ok(
    rejectionEvents.events.every(
      (event) => event.type !== 'capability_invocation_started',
    ),
  );

  const cancelled = rememberRun(
    await client.submitTask({
      message: 'Plan a cancelled verification change.',
      projectId: project.id,
      idempotencyKey: 'persistent-verification-cancelled',
    }),
  );
  await client.waitForRun(cancelled.runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  const cancellation = await client.cancelRun(cancelled.runId);
  assert.equal(cancellation.runStatus, 'cancelled');
  const cancellationEvents = await client.getRunEvents(cancelled.runId);
  assert.ok(
    cancellationEvents.events.some(
      (event) => event.type === 'cancellation_requested',
    ),
  );
  assert.ok(
    cancellationEvents.events.every(
      (event) => event.type !== 'capability_invocation_started',
    ),
  );

  const concurrent = await Promise.all(
    ['first', 'second'].map(async (label) =>
      rememberRun(
        await client.submitTask({
          message: `Plan the ${label} isolated verification change.`,
          projectId: project.id,
          idempotencyKey: `persistent-verification-concurrent-${label}`,
        }),
      ),
    ),
  );
  const concurrentPending = await Promise.all(
    concurrent.map(async (task) =>
      client.waitForRun(task.runId, {
        until: (current) => current.runStatus === 'awaiting_approval',
        timeoutMs: operationTimeoutMs,
        intervalMs: 25,
      }),
    ),
  );
  await Promise.all(
    concurrentPending.map(async (task) => {
      assert.ok(task.approval);
      return client.decideApproval(task.approval.id, 'approved');
    }),
  );
  const concurrentCompleted = await Promise.all(
    concurrent.map(async (task) =>
      client.waitForRun(task.runId, {
        timeoutMs: operationTimeoutMs,
        intervalMs: 25,
      }),
    ),
  );
  assert.ok(
    concurrentCompleted.every((task) => task.runStatus === 'succeeded'),
  );
  assert.equal(
    new Set(concurrentCompleted.map((task) => task.output?.artifact?.id)).size,
    2,
  );

  const personalTaskSubmitted = rememberRun(
    await client.submitTask({
      message: 'Add a task: Review Vera persistent verification',
      idempotencyKey: 'persistent-verification-personal-task-create',
    }),
  );
  const personalTaskApproval = await client.waitForRun(
    personalTaskSubmitted.runId,
    {
      until: (task) => task.runStatus === 'awaiting_approval',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.equal(
    personalTaskApproval.approval?.capability.name,
    'personal_task_management',
  );
  assert.deepEqual(personalTaskApproval.approval?.authority?.sideEffects, [
    'personal_data_write',
  ]);
  assert.ok(personalTaskApproval.approval);
  await client.decideApproval(personalTaskApproval.approval.id, 'approved');
  const personalTaskCreated = await client.waitForRun(
    personalTaskSubmitted.runId,
    { timeoutMs: operationTimeoutMs, intervalMs: 25 },
  );
  assert.equal(personalTaskCreated.output?.kind, 'personal_task_result');
  if (personalTaskCreated.output?.kind !== 'personal_task_result') {
    throw new Error(
      'Persistent personal task creation did not return a result.',
    );
  }
  const personalTaskId = personalTaskCreated.output.result.tasks[0]?.id;
  assert.ok(personalTaskId);
  assert.equal((await client.getPersonalTask(personalTaskId)).status, 'open');
  const attentionBeforeRestart = await client.getAttentionBriefing();
  const personalTaskAttention = attentionBeforeRestart.items.find(
    (item) =>
      item.target.kind === 'personal_task' &&
      item.target.personalTaskId === personalTaskId,
  );
  assert.ok(personalTaskAttention);
  const attentionItemId = personalTaskAttention.id;
  const dismissedAttention = await client.decideAttention({
    attentionItemId,
    decision: 'dismiss',
    idempotencyKey: 'persistent-verification-attention-dismiss',
  });
  assert.ok(
    dismissedAttention.dismissedItems.some(
      (item) => item.id === attentionItemId,
    ),
  );

  const reminderSubmitted = rememberRun(
    await client.submitTask({
      message:
        'Remind me to verify restart-safe scheduling at 2035-08-26T10:00:00.000Z',
      idempotencyKey: 'persistent-verification-reminder-create',
    }),
  );
  const reminderApproval = await client.waitForRun(reminderSubmitted.runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(
    reminderApproval.approval?.capability.name,
    'personal_reminder_management',
  );
  assert.deepEqual(reminderApproval.approval?.authority?.sideEffects, [
    'personal_data_write',
    'scheduled_notification',
  ]);
  assert.ok(reminderApproval.approval);
  await client.decideApproval(reminderApproval.approval.id, 'approved');
  const reminderCreated = await client.waitForRun(reminderSubmitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(reminderCreated.output?.kind, 'personal_reminder_result');
  if (reminderCreated.output?.kind !== 'personal_reminder_result') {
    throw new Error('Persistent reminder creation did not return a result.');
  }
  const reminderId = reminderCreated.output.result.reminders[0]?.id;
  assert.ok(reminderId);
  assert.equal((await client.getReminder(reminderId)).status, 'scheduled');

  const memorySubmitted = rememberRun(
    await client.submitTask({
      message: 'Remember that I prefer npm workspaces.',
      idempotencyKey: 'persistent-verification-memory-create',
    }),
  );
  const memoryApproval = await client.waitForRun(memorySubmitted.runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(memoryApproval.approval?.capability.name, 'memory_management');
  assert.deepEqual(memoryApproval.approval?.authority?.sideEffects, [
    'personal_data_write',
  ]);
  assert.ok(memoryApproval.approval);
  await client.decideApproval(memoryApproval.approval.id, 'approved');
  const memoryCreated = await client.waitForRun(memorySubmitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(memoryCreated.output?.kind, 'memory_result');
  if (memoryCreated.output?.kind !== 'memory_result') {
    throw new Error('Persistent memory creation did not return a result.');
  }
  const memoryId = memoryCreated.output.result.memories[0]?.id;
  assert.ok(memoryId);
  assert.equal((await client.getMemory(memoryId)).revision, 1);

  const memoryConversation = await client.createConversation({
    title: 'Persistent memory recall',
    idempotencyKey: 'persistent-verification-memory-conversation',
  });
  const memoryRecall = rememberRun(
    await client.appendMessage({
      conversationId: memoryConversation.id,
      content: 'Which workspace package manager do I prefer?',
      idempotencyKey: 'persistent-verification-memory-recall',
    }),
  );
  const memoryRecalled = await client.waitForRun(memoryRecall.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(memoryRecalled.runStatus, 'succeeded');
  assert.equal(memoryRecalled.conversationReply?.status, 'projected');
  assert.equal(memoryRecalled.memoryContextManifest?.totalMemories, 1);
  assert.equal(
    memoryRecalled.memoryContextManifest?.entries[0]?.memoryId,
    memoryId,
  );

  const adaptiveSubmitted = rememberRun(
    await client.submitTask({
      message:
        'Research whether deterministic verification evidence is available and if it is then remind me to review it at 2035-08-27T05:00:00.000Z',
      idempotencyKey: 'persistent-verification-adaptive-goal',
    }),
  );
  const adaptiveResearchApproval = await client.waitForRun(
    adaptiveSubmitted.runId,
    {
      until: (task) =>
        task.runStatus === 'awaiting_approval' &&
        task.approval?.capability.name === 'web_research',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.equal(adaptiveResearchApproval.goal?.schemaVersion, 2);
  assert.ok(adaptiveResearchApproval.approval);
  await client.decideApproval(adaptiveResearchApproval.approval.id, 'approved');
  const adaptiveReminderApproval = await client.waitForRun(
    adaptiveSubmitted.runId,
    {
      until: (task) =>
        task.runStatus === 'awaiting_approval' &&
        task.approval?.capability.name === 'personal_reminder_management',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.equal(adaptiveReminderApproval.approval?.inputArtifacts, undefined);
  assert.equal(
    adaptiveReminderApproval.approval?.decisionEvidence?.[0]?.type,
    'research_report',
  );
  assert.equal(adaptiveReminderApproval.approvalHistory?.length, 1);
  assert.equal(adaptiveReminderApproval.invocationHistory?.length, 1);

  await waitForLeaseRelease(mongo, adaptiveSubmitted.runId);
  await crashServer();
  started = await startServer(port);
  child = started.processHandle;
  client = new VeraClient({ baseUrl: started.baseUrl });
  const recoveredAdaptiveApproval = await client.getRun(
    adaptiveSubmitted.runId,
  );
  assert.equal(
    recoveredAdaptiveApproval.approval?.id,
    adaptiveReminderApproval.approval.id,
  );
  await client.decideApproval(adaptiveReminderApproval.approval.id, 'approved');
  const adaptiveCompleted = await client.waitForRun(adaptiveSubmitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(adaptiveCompleted.runStatus, 'succeeded');
  assert.equal(adaptiveCompleted.goal?.schemaVersion, 2);
  assert.equal(adaptiveCompleted.goal?.status, 'succeeded');
  assert.equal(adaptiveCompleted.output?.kind, 'adaptive_goal_result');
  if (adaptiveCompleted.output?.kind !== 'adaptive_goal_result') {
    throw new Error('Persistent adaptive goal did not return its result.');
  }
  assert.equal(adaptiveCompleted.output.artifacts.length, 2);
  assert.equal(adaptiveCompleted.output.evidence.length, 2);
  assert.equal(adaptiveCompleted.budget?.consumed.modelCalls, 3);
  assert.equal(adaptiveCompleted.budget?.consumed.capabilityInvocations, 2);
  const adaptiveReminderId = (
    await client.listReminders({ status: 'scheduled', limit: 100 })
  ).reminders.find(
    (reminder) => reminder.scheduledFor === '2035-08-27T05:00:00.000Z',
  )?.id;
  assert.ok(adaptiveReminderId);

  const goalSubmitted = rememberRun(
    await client.submitTask({
      message: 'Plan and implement a README update.',
      projectId: changeProject.id,
      idempotencyKey: 'persistent-verification-goal',
    }),
  );
  const goalPlanningApproval = await client.waitForRun(goalSubmitted.runId, {
    until: (task) =>
      task.runStatus === 'awaiting_approval' &&
      task.approval?.capability.name === 'development_planning',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.ok(goalPlanningApproval.approval);
  await client.decideApproval(goalPlanningApproval.approval.id, 'approved');
  const goalChangeApproval = await client.waitForRun(goalSubmitted.runId, {
    until: (task) =>
      task.runStatus === 'awaiting_approval' &&
      task.approval?.capability.name === 'software_change',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.ok(goalChangeApproval.approval);
  assert.notEqual(
    goalChangeApproval.approval.id,
    goalPlanningApproval.approval.id,
  );
  assert.equal(goalChangeApproval.approvalHistory?.length, 1);
  assert.equal(goalChangeApproval.invocationHistory?.length, 1);
  assert.equal(goalChangeApproval.approval.inputArtifacts?.length, 1);
  assert.equal(
    goalChangeApproval.approval.inputArtifacts?.[0]?.type,
    'implementation_plan',
  );

  await waitForLeaseRelease(mongo, goalSubmitted.runId);
  await crashServer();
  started = await startServer(port);
  child = started.processHandle;
  client = new VeraClient({ baseUrl: started.baseUrl });
  assert.equal((await client.getPersonalTask(personalTaskId)).status, 'open');
  assert.equal((await client.getReminder(reminderId)).status, 'scheduled');
  assert.equal((await client.getMemory(memoryId)).revision, 1);
  const attentionAfterRestart = await client.getAttentionBriefing();
  assert.ok(
    attentionAfterRestart.dismissedItems.some(
      (item) => item.id === attentionItemId,
    ),
  );

  const rescheduleSubmitted = rememberRun(
    await client.submitTask({
      message: `Reschedule ${reminderId} to 2026-08-25T10:00:00.000Z`,
      idempotencyKey: 'persistent-verification-reminder-reschedule',
    }),
  );
  const rescheduleApproval = await client.waitForRun(
    rescheduleSubmitted.runId,
    {
      until: (task) => task.runStatus === 'awaiting_approval',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.deepEqual(rescheduleApproval.approval?.proposedArguments, {
    action: 'reschedule',
    reminderId,
    scheduledFor: '2026-08-25T10:00:00.000Z',
    timeZone: 'Africa/Johannesburg',
  });
  assert.ok(rescheduleApproval.approval);
  await client.decideApproval(rescheduleApproval.approval.id, 'approved');
  await client.waitForRun(rescheduleSubmitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  let notifications;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    notifications = await client.listNotifications({ limit: 10 });
    if (
      notifications.notifications.some(
        (notification) => notification.reminderId === reminderId,
      )
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(notifications);
  const reminderNotification = notifications.notifications.find(
    (notification) => notification.reminderId === reminderId,
  );
  assert.ok(reminderNotification);
  assert.equal(reminderNotification.status, 'unread');
  assert.equal((await client.getReminder(reminderId)).status, 'delivered');

  const acknowledgeSubmitted = rememberRun(
    await client.submitTask({
      message: `Acknowledge ${reminderId}`,
      idempotencyKey: 'persistent-verification-reminder-acknowledge',
    }),
  );
  const acknowledgeApproval = await client.waitForRun(
    acknowledgeSubmitted.runId,
    {
      until: (task) => task.runStatus === 'awaiting_approval',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.ok(acknowledgeApproval.approval);
  await client.decideApproval(acknowledgeApproval.approval.id, 'approved');
  await client.waitForRun(acknowledgeSubmitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal((await client.getReminder(reminderId)).status, 'acknowledged');
  const recoveredGoalApproval = await client.getRun(goalSubmitted.runId);
  assert.equal(recoveredGoalApproval.runStatus, 'awaiting_approval');
  assert.equal(
    recoveredGoalApproval.approval?.id,
    goalChangeApproval.approval.id,
  );
  const replayedGoalApproval = await client.decideApproval(
    goalPlanningApproval.approval.id,
    'approved',
  );
  assert.equal(
    replayedGoalApproval.approval?.id,
    goalChangeApproval.approval.id,
  );
  await client.decideApproval(goalChangeApproval.approval.id, 'approved');
  const goalCompleted = await client.waitForRun(goalSubmitted.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(goalCompleted.runStatus, 'succeeded');
  assert.equal(goalCompleted.goal?.status, 'succeeded');
  assert.equal(goalCompleted.output?.kind, 'goal_result');
  assert.equal(goalCompleted.output?.artifacts.length, 2);
  const goalChangeArtifact = await client.getArtifact(
    goalCompleted.output.artifacts[1].id,
  );
  assert.equal(goalChangeArtifact.inputs?.length, 1);
  assert.equal(
    goalChangeArtifact.inputs?.[0]?.id,
    goalCompleted.output.artifacts[0].id,
  );

  const personalTaskCompletion = rememberRun(
    await client.submitTask({
      message: `Complete ${personalTaskId}`,
      idempotencyKey: 'persistent-verification-personal-task-complete',
    }),
  );
  const completionApproval = await client.waitForRun(
    personalTaskCompletion.runId,
    {
      until: (task) => task.runStatus === 'awaiting_approval',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.deepEqual(completionApproval.approval?.proposedArguments, {
    action: 'complete',
    taskId: personalTaskId,
  });
  assert.ok(completionApproval.approval);
  await client.decideApproval(completionApproval.approval.id, 'approved');
  const personalTaskCompleted = await client.waitForRun(
    personalTaskCompletion.runId,
    { timeoutMs: operationTimeoutMs, intervalMs: 25 },
  );
  assert.equal(personalTaskCompleted.runStatus, 'succeeded');
  assert.equal(
    (await client.getPersonalTask(personalTaskId)).status,
    'completed',
  );

  const memoryCorrection = rememberRun(
    await client.submitTask({
      message: `Correct memory ${memoryId}: I prefer pnpm workspaces.`,
      idempotencyKey: 'persistent-verification-memory-correct',
    }),
  );
  const memoryCorrectionApproval = await client.waitForRun(
    memoryCorrection.runId,
    {
      until: (task) => task.runStatus === 'awaiting_approval',
      timeoutMs: operationTimeoutMs,
      intervalMs: 25,
    },
  );
  assert.ok(memoryCorrectionApproval.approval);
  await client.decideApproval(memoryCorrectionApproval.approval.id, 'approved');
  await client.waitForRun(memoryCorrection.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  const correctedMemory = await client.getMemory(memoryId);
  assert.equal(correctedMemory.revision, 2);
  assert.equal(correctedMemory.content, 'I prefer pnpm workspaces.');
  assert.equal(correctedMemory.history[0]?.content, 'I prefer npm workspaces.');

  const memoryForget = rememberRun(
    await client.submitTask({
      message: `Forget memory ${memoryId}.`,
      idempotencyKey: 'persistent-verification-memory-forget',
    }),
  );
  const memoryForgetApproval = await client.waitForRun(memoryForget.runId, {
    until: (task) => task.runStatus === 'awaiting_approval',
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.ok(memoryForgetApproval.approval);
  await client.decideApproval(memoryForgetApproval.approval.id, 'approved');
  await client.waitForRun(memoryForget.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  const forgottenMemory = await client.getMemory(memoryId);
  assert.equal(forgottenMemory.revision, 2);
  assert.equal(forgottenMemory.status, 'forgotten');
  assert.deepEqual((await client.listMemories()).memories, []);

  const { applicationId, researchArtifactId } = await verifyCliJourney(
    started.baseUrl,
    changeProject.id,
    changeProjectRoot,
    client,
    personalTaskId,
    reminderId,
    memoryId,
  );
  await verifyLeaseExclusion();
  await verifyProjectMutationLeaseExclusion();
  await verifyIntegrationConnectionPersistence();
  await verifyExternalSignalPersistence();

  const legacyConversation = await client.createConversation({
    title: 'Legacy reply upgrade',
    idempotencyKey: 'persistent-verification-legacy-conversation',
  });
  const legacy = rememberRun(
    await client.appendMessage({
      conversationId: legacyConversation.id,
      content: 'Explain durable upgrades.',
      idempotencyKey: 'persistent-verification-legacy-message',
    }),
  );
  const legacyCompleted = await client.waitForRun(legacy.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(legacyCompleted.conversationReply?.status, 'projected');
  const legacyBeforeUpgrade = await client.getConversation(
    legacyConversation.id,
  );
  const legacyOwner = legacyBeforeUpgrade.messages.find(
    (message) => message.role === 'owner',
  );
  assert.ok(legacyOwner);

  await stopServer();
  const legacyAggregateUpdate = await mongo
    .db(database)
    .collection('task_execution_aggregates')
    .updateOne(
      { 'run.id': legacy.runId },
      {
        $unset: { 'run.conversationReply': '' },
        $pull: {
          events: {
            type: {
              $in: [
                'conversation_reply_pending',
                'conversation_reply_projected',
              ],
            },
          },
        },
        $set: {
          'run.updatedAt': legacyCompleted.conversationReply.createdAt,
          'task.updatedAt': legacyCompleted.conversationReply.createdAt,
        },
        $inc: { version: 1 },
      },
    );
  assert.equal(legacyAggregateUpdate.modifiedCount, 1);
  const legacyConversationUpdate = await mongo
    .db(database)
    .collection('conversations')
    .updateOne(
      { id: legacyConversation.id },
      {
        $pull: { messages: { role: 'vera', taskId: legacy.taskId } },
        $set: { updatedAt: legacyOwner.createdAt },
      },
    );
  assert.equal(legacyConversationUpdate.modifiedCount, 1);
  started = await startServer(port);
  child = started.processHandle;
  const recoveredClient = new VeraClient({ baseUrl: started.baseUrl });
  const recovered = await recoveredClient.getRun(submitted.runId);
  assert.equal(recovered.runStatus, 'succeeded');
  assert.equal(recovered.output?.artifact?.id, artifact.id);
  assert.equal(
    (await recoveredClient.getArtifact(artifact.id)).sha256,
    artifact.sha256,
  );
  assert.equal(
    (await recoveredClient.getArtifact(researchArtifactId)).type,
    'research_report',
  );
  assert.equal(
    (await recoveredClient.getPersonalTask(personalTaskId)).status,
    'completed',
  );
  assert.equal(
    (await recoveredClient.getReminder(reminderId)).status,
    'acknowledged',
  );
  const recoveredMemory = await recoveredClient.getMemory(memoryId);
  assert.equal(recoveredMemory.status, 'forgotten');
  assert.equal(recoveredMemory.revision, 2);
  const recoveredAdaptiveGoal = await recoveredClient.getRun(
    adaptiveSubmitted.runId,
  );
  assert.equal(recoveredAdaptiveGoal.runStatus, 'succeeded');
  assert.equal(recoveredAdaptiveGoal.output?.kind, 'adaptive_goal_result');
  assert.equal(
    (await recoveredClient.getReminder(adaptiveReminderId)).status,
    'scheduled',
  );
  const upgradedLegacy = await recoveredClient.waitForRun(legacy.runId, {
    timeoutMs: operationTimeoutMs,
    intervalMs: 25,
  });
  assert.equal(upgradedLegacy.conversationReply?.status, 'projected');
  const upgradedLegacyConversation = await recoveredClient.getConversation(
    legacyConversation.id,
  );
  assert.deepEqual(
    upgradedLegacyConversation.messages.map(({ role, taskId }) => ({
      role,
      taskId,
    })),
    [
      { role: 'owner', taskId: legacy.taskId },
      { role: 'vera', taskId: legacy.taskId },
    ],
  );
  const recoveredConversation = await recoveredClient.getConversation(
    conversation.id,
  );
  assert.equal(recoveredConversation.messages.length, 6);
  assert.deepEqual(
    recoveredConversation.messages.map(({ role, taskId }) => ({
      role,
      taskId,
    })),
    [
      { role: 'owner', taskId: submitted.taskId },
      { role: 'owner', taskId: collidingOwnerCompleted.taskId },
      { role: 'vera', taskId: collidingOwnerCompleted.taskId },
      { role: 'vera', taskId: submitted.taskId },
      { role: 'owner', taskId: followupCompleted.taskId },
      { role: 'vera', taskId: followupCompleted.taskId },
    ],
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
  const applications = await mongo
    .db(database)
    .collection('change_applications')
    .find({})
    .toArray();
  const personalTasks = await mongo
    .db(database)
    .collection('personal_tasks')
    .find({})
    .toArray();
  const reminders = await mongo
    .db(database)
    .collection('reminders')
    .find({})
    .toArray();
  const memories = await mongo
    .db(database)
    .collection('memories')
    .find({})
    .toArray();
  const integrationConnections = await mongo
    .db(database)
    .collection('integration_connections')
    .find({})
    .toArray();
  assert.equal(aggregates.length, 24);
  assert.equal(artifacts.length, 18);
  assert.equal(personalTasks.length, 1);
  assert.equal(personalTasks[0]?.id, personalTaskId);
  assert.equal(personalTasks[0]?.status, 'completed');
  assert.equal(reminders.length, 2);
  const acknowledgedReminder = reminders.find(
    (candidate) => candidate.id === reminderId,
  );
  assert.equal(acknowledgedReminder?.status, 'acknowledged');
  assert.equal(acknowledgedReminder?.notification?.channel, 'vera_inbox');
  const adaptiveReminder = reminders.find(
    (candidate) => candidate.id === adaptiveReminderId,
  );
  assert.equal(adaptiveReminder?.status, 'scheduled');
  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.id, memoryId);
  assert.equal(memories[0]?.status, 'forgotten');
  assert.equal(memories[0]?.revision, 2);
  assert.equal(integrationConnections.length, 1);
  assert.equal(integrationConnections[0]?.integrationId, 'github');
  assert.equal(
    JSON.stringify(integrationConnections[0]).includes('token'),
    false,
  );
  assert.equal(applications.length, 1);
  assert.equal(applications[0]?.id, applicationId);
  assert.equal(
    new Set(artifacts.map((candidate) => candidate.invocationId)).size,
    artifacts.length,
  );

  return {
    durationMs: Date.now() - startedAt,
    taskCount: aggregates.length,
    artifactCount: artifacts.length,
    changeApplicationCount: applications.length,
    eventCount: aggregates.reduce(
      (total, aggregate) => total + aggregate.events.length,
      0,
    ),
    forcedRestartVerified: true,
    restartVerified: true,
    scratchpadRebuilt: true,
    leaseExclusionVerified: true,
    projectMutationLeaseExclusionVerified: true,
    integrationConnectionPersistenceVerified: true,
    externalSignalPersistenceVerified: true,
    cliJourneyVerified: true,
    boundedGoalVerified: true,
    adaptiveGoalVerified: true,
    managedChangeApplicationVerified: true,
    durableResearchVerified: true,
    durablePersonalTasksVerified: true,
    durableRemindersVerified: true,
    governedMemoryVerified: true,
    groundedKnowledgePersistenceVerified: true,
    attentionDispositionRestartVerified: true,
    durableStandingRoutineVerified: true,
    restartSafeNotificationDeliveryVerified: true,
    durableDevicePushVerified: true,
    legacyConversationUpgradeVerified: true,
    roleScopedMessageIdempotencyVerified: true,
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
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true }).catch((error) =>
      errors.push(error),
    );
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Persistent verification cleanup failed.');
  }
}

let evidence;
let verificationError;
try {
  await Promise.all([mongo.connect(), redis.connect()]);
  evidence = await verifyScenarios(mongo, redis);
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
      database,
      inference: 'deterministic',
      planningAdapter: 'structured_model',
      changeAdapter: 'deterministic_change',
      researchAdapter: 'deterministic_research',
      externalModelDownloads: false,
      ...evidence,
    },
    null,
    2,
  )}\n`,
);
