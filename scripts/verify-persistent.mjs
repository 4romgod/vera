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
import { VeraClient } from '../packages/client/dist/index.js';

const executeFile = promisify(execFile);
const root = process.cwd();
const mongodbUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const database = `vera_verify_${randomUUID().replaceAll('-', '_')}`;
const changeApplicationRoot = join(tmpdir(), `${database}_applications`);
const operationTimeoutMs = 10_000;
const runIds = new Set();
const temporaryDirectories = new Set([changeApplicationRoot]);
let child;
let serverOutput = '';

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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-20_000);
  };
  processHandle.stdout.on('data', capture);
  processHandle.stderr.on('data', capture);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

async function verifyCliJourney(
  baseUrl,
  changeProjectId,
  changeProjectRoot,
  client,
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
  const port = await availablePort();
  let started = await startServer(port);
  child = started.processHandle;
  let client = new VeraClient({ baseUrl: started.baseUrl });

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
    content: 'Plan a documentation health-check command.',
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

  const { applicationId, researchArtifactId } = await verifyCliJourney(
    started.baseUrl,
    changeProject.id,
    changeProjectRoot,
    client,
  );
  await verifyLeaseExclusion();
  await verifyProjectMutationLeaseExclusion();

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
  assert.equal(aggregates.length, 13);
  assert.equal(artifacts.length, 6);
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
    cliJourneyVerified: true,
    managedChangeApplicationVerified: true,
    durableResearchVerified: true,
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
