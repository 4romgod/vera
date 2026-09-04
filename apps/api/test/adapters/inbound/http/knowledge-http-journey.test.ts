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
    application: { workspacesRoot: '/tmp/vera-knowledge-http' },
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

type RunBody = {
  runStatus: string;
  approval?: {
    id: string;
    capability: { name: string };
    authority: {
      approval: string;
      dataClasses: string[];
      sideEffects: string[];
    };
    inputArtifacts?: { type: string }[];
  };
  output?: {
    kind: string;
    result?: { answer?: string; citations?: { sourceId: string }[] };
  };
  conversationReply?: { status: string };
};

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

async function approve(
  app: ReturnType<typeof createApp>,
  runId: string,
  capability: string,
): Promise<void> {
  const pending = await waitForRun(
    app,
    runId,
    (body) =>
      body.runStatus === 'awaiting_approval' &&
      body.approval?.capability.name === capability,
  );
  assert.ok(pending.approval);
  const response = await app.inject({
    method: 'POST',
    url: `/v1/approvals/${pending.approval.id}/decision`,
    payload: { decision: 'approved' },
  });
  assert.equal(response.statusCode, 202, response.body);
}

async function uploadDocument(app: ReturnType<typeof createApp>) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/attachments',
    headers: {
      'content-type': 'application/octet-stream',
      'x-vera-filename': encodeURIComponent('private-notes.txt'),
      'x-vera-media-type': 'text/plain',
    },
    payload:
      'Project Neptune uses a yellow launch checklist. The accountable owner is Ada.',
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ id: string }>().id;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('grounded knowledge HTTP journey', () => {
  void it('adds idempotently, searches exact evidence, and removes source text', async () => {
    const app = createApp(config());
    apps.push(app);
    const attachmentId = await uploadDocument(app);
    const request = {
      method: 'POST' as const,
      url: '/v1/knowledge-sources',
      headers: { 'idempotency-key': 'knowledge-direct-create' },
      payload: {
        title: 'Project Neptune notes',
        scope: { kind: 'global' },
        attachmentIds: [attachmentId],
      },
    };

    const created = await app.inject(request);
    assert.equal(created.statusCode, 201, created.body);
    const source = created.json<{ id: string; chunkCount: number }>();
    assert.equal(source.chunkCount, 1);
    const replayed = await app.inject(request);
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json<{ id: string }>().id, source.id);
    const conflictingReplay = await app.inject({
      ...request,
      payload: { ...request.payload, title: 'Different source' },
    });
    assert.equal(conflictingReplay.statusCode, 409, conflictingReplay.body);
    assert.equal(
      conflictingReplay.json<{ error: { code: string } }>().error.code,
      'idempotency_key_reused',
    );

    const searched = await app.inject({
      method: 'POST',
      url: '/v1/knowledge-search',
      payload: { query: 'Who owns Project Neptune?' },
    });
    assert.equal(searched.statusCode, 200, searched.body);
    const citations = searched.json<{
      citations: { sourceId: string; locator: string; excerpt: string }[];
    }>().citations;
    const citation = citations[0];
    assert.ok(citation);
    assert.equal(citation.sourceId, source.id);
    assert.match(citation.locator, /private-notes\.txt/u);
    assert.match(citation.excerpt, /accountable owner is Ada/u);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/knowledge-sources/${source.id}`,
    });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(
      removed.json<{ status: string; chunkCount: number }>().status,
      'removed',
    );
    assert.equal(
      removed.json<{ status: string; chunkCount: number }>().chunkCount,
      0,
    );
    const afterRemoval = await app.inject({
      method: 'POST',
      url: '/v1/knowledge-search',
      payload: { query: 'Neptune' },
    });
    assert.deepEqual(
      afterRemoval.json<{ citations: unknown[] }>().citations,
      [],
    );
  });

  void it('understands an attachment, asks separately before saving it, and answers with citations', async () => {
    const app = createApp(config());
    apps.push(app);
    const attachmentId = await uploadDocument(app);
    const conversation = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'knowledge-conversation' },
      payload: { title: 'Grounded knowledge' },
    });
    const conversationId = conversation.json<{ id: string }>().id;
    const message = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'knowledge-conversation-add' },
      payload: {
        content:
          'Save this file to my knowledge library as Project Neptune notes.',
        attachmentIds: [attachmentId],
      },
    });
    assert.equal(message.statusCode, 202, message.body);
    const runId = message.json<{ runId: string }>().runId;

    await approve(app, runId, 'attachment_analysis');
    const saveApproval = await waitForRun(
      app,
      runId,
      (body) =>
        body.runStatus === 'awaiting_approval' &&
        body.approval?.capability.name === 'knowledge_management',
    );
    assert.ok(saveApproval.approval);
    assert.deepEqual(
      saveApproval.approval.inputArtifacts?.map(({ type }) => type),
      ['attachment_analysis'],
    );
    assert.deepEqual(saveApproval.approval.authority.sideEffects, [
      'personal_data_write',
      'knowledge_write',
    ]);
    await approve(app, runId, 'knowledge_management');
    const completed = await waitForRun(
      app,
      runId,
      (body) =>
        body.runStatus === 'succeeded' &&
        body.conversationReply?.status === 'projected',
    );
    assert.equal(completed.output?.kind, 'adaptive_goal_result');
    const sources = await app.inject({
      method: 'GET',
      url: '/v1/knowledge-sources',
    });
    assert.equal(sources.statusCode, 200, sources.body);
    assert.equal(
      sources.json<{ sources: { title: string }[] }>().sources[0]?.title,
      'Project Neptune notes',
    );

    const search = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'knowledge-conversation-search' },
      payload: {
        message: 'Search my knowledge library for Project Neptune owner.',
      },
    });
    assert.equal(search.statusCode, 202, search.body);
    const answer = await waitForRun(
      app,
      search.json<{ runId: string }>().runId,
      (body) => body.runStatus === 'succeeded',
    );
    assert.equal(answer.output?.kind, 'knowledge_result');
    assert.ok(answer.output.result);
    assert.match(answer.output.result.answer ?? '', /Ada/u);
    assert.equal(answer.output.result.citations?.length, 1);
  });
});
