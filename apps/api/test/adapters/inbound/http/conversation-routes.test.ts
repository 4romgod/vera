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
    application: { workspacesRoot: '/tmp/vera-conversation-http' },
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

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('conversation HTTP routes', () => {
  void it('removes a conversation idempotently and excludes it from owner reads', async () => {
    const app = createApp(config());
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'conversation-to-remove' },
      payload: { title: 'Remove me' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ id: string }>().id;

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${conversationId}`,
    });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.deepEqual(removed.json<{ id: string; status: string }>(), {
      schemaVersion: 1,
      id: conversationId,
      status: 'removed',
      removedAt: removed.json<{ removedAt: string }>().removedAt,
    });

    const replay = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${conversationId}`,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(
      replay.json<{ removedAt: string }>().removedAt,
      removed.json<{ removedAt: string }>().removedAt,
    );

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/conversations',
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.deepEqual(
      listed.json<{ conversations: unknown[] }>().conversations,
      [],
    );
    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    assert.equal(fetched.statusCode, 404, fetched.body);
    assert.equal(
      fetched.json<{ error: { code: string } }>().error.code,
      'conversation_not_found',
    );
  });
});
