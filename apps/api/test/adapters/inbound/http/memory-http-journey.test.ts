import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AppConfig } from '../../../../src/bootstrap/config.ts';
import { createApp } from '../../../../src/bootstrap/wiring.ts';

const apps: ReturnType<typeof createApp>[] = [];

function config(): AppConfig {
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
    research: { adapterId: 'disabled' },
    transcription: { provider: 'disabled', maxAudioBytes: 25_000_000 },
    application: { workspacesRoot: '/tmp/vera-memory-http' },
    publication: {
      adapterId: 'github_gh_cli',
      gitCommand: 'git',
      ghCommand: 'gh',
    },
    worker: { concurrency: 2, pollIntervalMs: 5, leaseMs: 900_000 },
    reminders: {
      ownerTimeZone: 'Africa/Johannesburg',
      concurrency: 1,
      pollIntervalMs: 25,
      leaseMs: 1_000,
    },
  };
}

async function waitForRun(
  app: ReturnType<typeof createApp>,
  runId: string,
  predicate: (body: RunBody) => boolean,
): Promise<RunBody> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<RunBody>();
    if (predicate(body)) return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach the requested state.`);
}

type RunBody = {
  runStatus: string;
  approval?: {
    id: string;
    capability: { name: string };
    proposedArguments: Record<string, unknown>;
    authority: { dataClasses: string[]; sideEffects: string[] };
  };
  output?: { kind: string; artifact?: { id: string } };
  memoryContextManifest?: { totalMemories: number; entries: unknown[] };
  conversationReply?: { status: string };
};

async function createConversation(
  app: ReturnType<typeof createApp>,
  key: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    headers: { 'idempotency-key': key },
    payload: { title: key },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ id: string }>().id;
}

async function submitMessage(
  app: ReturnType<typeof createApp>,
  conversationId: string,
  key: string,
  content: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    headers: { 'idempotency-key': key },
    payload: { content },
  });
  assert.equal(response.statusCode, 202, response.body);
  return response.json<{ runId: string }>().runId;
}

async function approveMemoryRun(
  app: ReturnType<typeof createApp>,
  runId: string,
): Promise<RunBody> {
  const pending = await waitForRun(
    app,
    runId,
    (body) => body.runStatus === 'awaiting_approval',
  );
  assert.ok(pending.approval);
  assert.equal(pending.approval.capability.name, 'memory_management');
  assert.deepEqual(pending.approval.authority.dataClasses, [
    'owner_request',
    'long_term_memory',
  ]);
  const decision = await app.inject({
    method: 'POST',
    url: `/v1/approvals/${pending.approval.id}/decision`,
    payload: { decision: 'approved' },
  });
  assert.equal(decision.statusCode, 202, decision.body);
  return waitForRun(
    app,
    runId,
    (body) =>
      body.runStatus === 'succeeded' &&
      body.conversationReply?.status === 'projected',
  );
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('governed memory HTTP journey', () => {
  void it('remembers with approval, carries bounded memory across conversations, corrects, and forgets', async () => {
    const app = createApp(config());
    apps.push(app);
    const firstConversation = await createConversation(app, 'memory-first');
    const rememberRun = await submitMessage(
      app,
      firstConversation,
      'memory-remember',
      'Remember that I prefer npm workspaces.',
    );
    const remembered = await approveMemoryRun(app, rememberRun);
    assert.equal(remembered.output?.kind, 'memory_result');

    const list = await app.inject({ method: 'GET', url: '/v1/memories' });
    assert.equal(list.statusCode, 200, list.body);
    const memory = list.json<{
      memories: {
        id: string;
        revision: number;
        content: string;
        status: string;
        provenance: { conversationId?: string; messageId?: string };
      }[];
    }>().memories[0];
    assert.ok(memory);
    assert.equal(memory.content, 'I prefer npm workspaces.');
    assert.equal(memory.revision, 1);
    assert.equal(memory.status, 'active');
    assert.equal(memory.provenance.conversationId, firstConversation);
    assert.ok(memory.provenance.messageId);

    const secondConversation = await createConversation(app, 'memory-second');
    const recallRun = await submitMessage(
      app,
      secondConversation,
      'memory-recall',
      'Which package manager should I use?',
    );
    const recalled = await waitForRun(
      app,
      recallRun,
      (body) =>
        body.runStatus === 'succeeded' &&
        body.conversationReply?.status === 'projected',
    );
    assert.ok(recalled.memoryContextManifest);
    assert.equal(recalled.memoryContextManifest.totalMemories, 1);
    assert.equal(recalled.memoryContextManifest.entries.length, 1);

    const correctRun = await submitMessage(
      app,
      secondConversation,
      'memory-correct',
      `Correct memory ${memory.id}. Its new content is: I prefer pnpm workspaces.`,
    );
    await approveMemoryRun(app, correctRun);
    const corrected = await app.inject({
      method: 'GET',
      url: `/v1/memories/${memory.id}`,
    });
    assert.equal(corrected.statusCode, 200, corrected.body);
    const correctedMemory = corrected.json<{
      revision: number;
      content: string;
      history: { content: string }[];
    }>();
    assert.equal(correctedMemory.revision, 2);
    assert.equal(correctedMemory.content, 'I prefer pnpm workspaces.');
    assert.equal(
      correctedMemory.history[0]?.content,
      'I prefer npm workspaces.',
    );

    const forgetRun = await submitMessage(
      app,
      secondConversation,
      'memory-forget',
      `Forget memory ${memory.id}.`,
    );
    await approveMemoryRun(app, forgetRun);
    const active = await app.inject({ method: 'GET', url: '/v1/memories' });
    assert.deepEqual(active.json<{ memories: unknown[] }>().memories, []);
    const all = await app.inject({
      method: 'GET',
      url: '/v1/memories?status=all',
    });
    assert.equal(
      all.json<{ memories: { status: string }[] }>().memories[0]?.status,
      'forgotten',
    );
  });
});
