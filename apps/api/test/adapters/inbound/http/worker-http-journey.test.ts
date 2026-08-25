import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

import type { AppConfig } from '../../../../src/bootstrap/config.ts';
import { createApp } from '../../../../src/bootstrap/wiring.ts';

const executeFile = promisify(execFile);
const cleanups: (() => Promise<void>)[] = [];

function config(workspacesRoot = '/tmp/vera-test-applications'): AppConfig {
  return {
    host: '127.0.0.1',
    port: 4310,
    model: { provider: 'deterministic', model: 'deterministic-v1' },
    conversationContext: { maxMessages: 20, maxCharacters: 40_000 },
    storage: {
      mode: 'memory',
      mongodbUri: 'mongodb://127.0.0.1:27017',
      mongodbDatabase: 'unused',
      redisUrl: 'redis://127.0.0.1:6379',
      scratchpadTtlSeconds: 60,
      dependencyTimeoutMs: 250,
    },
    planning: {
      adapterId: 'structured_model',
      adapters: { codexCli: { command: 'codex' } },
    },
    change: {
      adapterId: 'deterministic_change',
      adapters: { codexCli: { command: 'codex' } },
    },
    application: { workspacesRoot },
    worker: { concurrency: 2, pollIntervalMs: 25, leaseMs: 900_000 },
  };
}

async function waitForApplication(
  app: ReturnType<typeof createApp>,
  applicationId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/change-applications/${applicationId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      id: string;
      status: string;
      result?: { workspacePath: string; branchName: string };
    }>();
    if (body.status === status) return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `Change application ${applicationId} did not reach ${status}.`,
  );
}

async function waitForRun(
  app: ReturnType<typeof createApp>,
  runId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      runStatus: string;
      approval?: {
        id: string;
        status: string;
        proposedArguments: Record<string, unknown>;
      };
      output?: { artifact?: { id: string } };
    }>();
    if (body.runStatus === status) return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach ${status}.`);
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => cleanup()));
});

void describe('production worker HTTP journey', () => {
  void it('returns durable commands before background decision and execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-worker-http-'));
    await executeFile('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# Worker fixture\n', 'utf8');
    await executeFile('git', ['add', 'README.md'], { cwd: root });
    await executeFile(
      'git',
      [
        '-c',
        'user.name=Vera Test',
        '-c',
        'user.email=vera@example.test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const app = createApp(config());
    cleanups.push(
      async () => app.close(),
      async () => rm(root, { recursive: true }),
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { 'idempotency-key': 'worker-http-project' },
      payload: {
        displayName: 'Worker fixture',
        source: { kind: 'local_git', rootPath: root },
      },
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const projectId = registered.json<{ id: string }>().id;

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'worker-http-task' },
      payload: { message: 'Plan a README update.', projectId },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const initial = submitted.json<{
      runId: string;
      runStatus: string;
    }>();
    assert.equal(initial.runStatus, 'deciding');

    const pending = await waitForRun(app, initial.runId, 'awaiting_approval');
    assert.ok(pending.approval);
    assert.equal(pending.approval.status, 'pending');
    assert.deepEqual(pending.approval.proposedArguments, {
      objective: 'Plan a README update.',
      ticket: {
        reference: 'untracked',
        details: 'Plan a README update.',
      },
      project: { name: 'Worker fixture' },
    });

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);
    assert.equal(
      approved.json<{ runStatus: string }>().runStatus,
      'awaiting_approval',
    );

    const completed = await waitForRun(app, initial.runId, 'succeeded');
    assert.ok(completed.output?.artifact);
    const artifact = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${completed.output.artifact.id}`,
    });
    assert.equal(artifact.statusCode, 200, artifact.body);
  });

  void it('applies one approved software-change artifact to a durable managed worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-application-project-'));
    const workspaces = await mkdtemp(
      join(tmpdir(), 'vera-application-workspaces-'),
    );
    await executeFile('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# Application fixture\n', 'utf8');
    await executeFile('git', ['add', 'README.md'], { cwd: root });
    await executeFile(
      'git',
      [
        '-c',
        'user.name=Vera Test',
        '-c',
        'user.email=vera@example.test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const app = createApp(config(workspaces));
    cleanups.push(
      async () => app.close(),
      async () => rm(root, { recursive: true, force: true }),
      async () => rm(workspaces, { recursive: true, force: true }),
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { 'idempotency-key': 'application-project' },
      payload: {
        displayName: 'Application fixture',
        source: { kind: 'local_git', rootPath: root },
      },
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const projectId = registered.json<{ id: string }>().id;

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'application-change' },
      payload: { message: 'Implement the approved fixture change.', projectId },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;
    const pending = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(pending.approval);
    const approvedChange = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedChange.statusCode, 202, approvedChange.body);
    const completedChange = await waitForRun(app, runId, 'succeeded');
    assert.ok(completedChange.output?.artifact);

    const requestedApplication = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${completedChange.output.artifact.id}/applications`,
      headers: { 'idempotency-key': 'application-effect' },
    });
    assert.equal(
      requestedApplication.statusCode,
      202,
      requestedApplication.body,
    );
    const pendingApplication = requestedApplication.json<{
      id: string;
      status: string;
      approval: { effect: { staged: boolean; workspacePath: string } };
    }>();
    assert.equal(pendingApplication.status, 'awaiting_approval');
    assert.equal(pendingApplication.approval.effect.staged, true);

    const approvedApplication = await app.inject({
      method: 'POST',
      url: `/v1/change-applications/${pendingApplication.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedApplication.statusCode, 202, approvedApplication.body);
    const completedApplication = await waitForApplication(
      app,
      pendingApplication.id,
      'succeeded',
    );
    assert.ok(completedApplication.result);
    assert.equal(
      await readFile(join(root, 'README.md'), 'utf8'),
      '# Application fixture\n',
    );
    assert.match(
      await readFile(
        join(
          completedApplication.result.workspacePath,
          'VERA_DETERMINISTIC_CHANGE.md',
        ),
        'utf8',
      ),
      /Implement the approved fixture change\./u,
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${completedChange.output.artifact.id}/applications`,
      headers: { 'idempotency-key': 'application-effect' },
    });
    assert.equal(duplicate.statusCode, 202, duplicate.body);
    assert.equal(duplicate.json<{ id: string }>().id, pendingApplication.id);

    const events = await app.inject({
      method: 'GET',
      url: `/v1/change-applications/${pendingApplication.id}/events`,
    });
    assert.equal(events.statusCode, 200, events.body);
    assert.deepEqual(
      events
        .json<{ events: { type: string }[] }>()
        .events.map((event) => event.type),
      [
        'change_application_created',
        'change_application_approval_requested',
        'change_application_approval_approved',
        'change_application_started',
        'change_application_succeeded',
      ],
    );
  });
});
