import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AppConfig } from '../../src/bootstrap/config.ts';
import { createApp } from '../../src/bootstrap/wiring.ts';

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
    application: { workspacesRoot: '/tmp/vera-attention-http' },
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
  approval?: { id: string; capability: { name: string } };
  output?: { kind: string; result?: { briefing?: AttentionBody } };
  conversationReply?: { status: string };
};

type AttentionBody = {
  headline: string;
  counts: {
    urgent: number;
    high: number;
    normal: number;
    snoozed: number;
    dismissed: number;
  };
  items: { id: string; title: string; state: string; reason: string }[];
  snoozedItems: { id: string; state: string; snoozedUntil?: string }[];
  dismissedItems: { id: string; state: string }[];
};

async function waitForRun(
  app: ReturnType<typeof createApp>,
  runId: string,
  predicate: (run: RunBody) => boolean,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const run = response.json<RunBody>();
    if (predicate(run)) return run;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not settle.`);
}

async function send(
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

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('proactive attention journey', () => {
  void it('projects current work, persists owner disposition, and briefs through conversation', async () => {
    const app = createApp(config(), { logger: false });
    apps.push(app);

    const empty = await app.inject({ method: 'GET', url: '/v1/attention' });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json<AttentionBody>().items.length, 0);

    const createdConversation = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'attention-conversation' },
      payload: { title: 'Attention journey' },
    });
    assert.equal(createdConversation.statusCode, 201, createdConversation.body);
    const conversationId = createdConversation.json<{ id: string }>().id;

    const createRunId = await send(
      app,
      conversationId,
      'attention-task-create',
      'Create task: Review the Vera briefing',
    );
    const pending = await waitForRun(
      app,
      createRunId,
      (run) => run.runStatus === 'awaiting_approval',
    );
    assert.equal(pending.approval?.capability.name, 'personal_task_management');
    const approval = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approval.statusCode, 202, approval.body);
    await waitForRun(
      app,
      createRunId,
      (run) =>
        run.runStatus === 'succeeded' &&
        run.conversationReply?.status === 'projected',
    );

    const currentResponse = await app.inject({
      method: 'GET',
      url: '/v1/attention',
    });
    assert.equal(currentResponse.statusCode, 200, currentResponse.body);
    const current = currentResponse.json<AttentionBody>();
    assert.equal(current.counts.normal, 1);
    assert.equal(current.items[0]?.title, 'Review the Vera briefing');
    const currentItem = current.items[0];
    assert.ok(currentItem);
    const itemId = currentItem.id;

    const snoozedUntil = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    const snoozedResponse = await app.inject({
      method: 'POST',
      url: `/v1/attention-items/${itemId}/decision`,
      headers: { 'idempotency-key': 'attention-snooze-1' },
      payload: { decision: 'snooze', snoozedUntil },
    });
    assert.equal(snoozedResponse.statusCode, 200, snoozedResponse.body);
    const snoozed = snoozedResponse.json<AttentionBody>();
    assert.equal(snoozed.items.length, 0);
    assert.equal(snoozed.snoozedItems[0]?.id, itemId);

    const conflict = await app.inject({
      method: 'POST',
      url: `/v1/attention-items/${itemId}/decision`,
      headers: { 'idempotency-key': 'attention-snooze-1' },
      payload: { decision: 'dismiss' },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);

    const restored = await app.inject({
      method: 'POST',
      url: `/v1/attention-items/${itemId}/decision`,
      headers: { 'idempotency-key': 'attention-restore-1' },
      payload: { decision: 'restore' },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json<AttentionBody>().items[0]?.id, itemId);

    const briefingRunId = await send(
      app,
      conversationId,
      'attention-conversation-brief',
      'Brief me. What needs my attention?',
    );
    const briefingRun = await waitForRun(
      app,
      briefingRunId,
      (run) =>
        run.runStatus === 'succeeded' &&
        run.conversationReply?.status === 'projected',
    );
    const briefingOutput = briefingRun.output;
    if (
      briefingOutput?.kind !== 'attention_result' ||
      briefingOutput.result?.briefing === undefined
    ) {
      throw new Error('Expected the attention briefing capability result.');
    }
    assert.equal(briefingOutput.result.briefing.items[0]?.id, itemId);
  });
});
