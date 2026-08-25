import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

import type { AppConfig } from '../src/config.ts';
import { createApp } from '../src/wiring.ts';

const executeFile = promisify(execFile);
const cleanups: (() => Promise<void>)[] = [];

function config(): AppConfig {
  return {
    host: '127.0.0.1',
    port: 4310,
    modelProvider: 'deterministic',
    ollama: {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'deterministic-v1',
      timeoutMs: 1_000,
      readinessTimeoutMs: 250,
    },
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
    worker: { concurrency: 2, pollIntervalMs: 25, leaseMs: 900_000 },
  };
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
});
