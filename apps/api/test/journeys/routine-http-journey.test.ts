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
    application: { workspacesRoot: '/tmp/vera-routine-http' },
    publication: {
      adapterId: 'github_gh_cli',
      gitCommand: 'git',
      ghCommand: 'gh',
    },
    worker: { concurrency: 1, pollIntervalMs: 5, leaseMs: 900_000 },
    reminders: {
      ownerTimeZone: 'Africa/Johannesburg',
      concurrency: 1,
      pollIntervalMs: 25,
      leaseMs: 1_000,
    },
    machines: {
      schemaVersion: 1,
      machines: [
        {
          id: 'test-machine',
          displayName: 'Test machine',
          adapter: { kind: 'local' },
          diagnostics: [],
          services: [
            {
              id: 'test-service',
              displayName: 'Test service',
              probe: {
                kind: 'command',
                command: {
                  executable: process.execPath,
                  arguments: ['-e', 'process.exit(0)'],
                  timeoutMs: 2_000,
                },
                healthyExitCodes: [0],
              },
              actions: {},
            },
          ],
        },
      ],
    },
  };
}

async function waitForRoutineRun(
  app: ReturnType<typeof createApp>,
  routineId: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/routines/${routineId}/runs`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const run = response.json<{
      runs: { status: string; result?: { outcome: string } }[];
    }>().runs[0];
    if (run?.status === 'succeeded') return run;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Routine run did not settle.');
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('durable standing routine journey', () => {
  void it('holds the event-triggered routine contract closed at the transport boundary', async () => {
    const app = createApp(config(), { logger: false });
    apps.push(app);

    const legacy = await app.inject({
      method: 'POST',
      url: '/v1/routines',
      headers: { 'idempotency-key': 'legacy-schedule-body' },
      payload: {
        title: 'Legacy shape',
        schedule: { kind: 'interval', minutes: 15 },
        action: { kind: 'machine_health_check', machineId: 'test-machine' },
      },
    });
    assert.equal(legacy.statusCode, 400, legacy.body);

    const unbudgeted = await app.inject({
      method: 'POST',
      url: '/v1/routines',
      headers: { 'idempotency-key': 'triage-without-budget' },
      payload: {
        title: 'Triage without a budget',
        trigger: {
          kind: 'external_signal',
          integrationId: 'github',
          projectId: 'project_alpha',
          categories: ['failed_check'],
        },
        action: {
          kind: 'signal_triage',
          response: 'investigate_and_propose',
          disclosure: 'minimized_signal_evidence',
        },
      },
    });
    assert.equal(unbudgeted.statusCode, 422, unbudgeted.body);

    const mismatched = await app.inject({
      method: 'POST',
      url: '/v1/routines',
      headers: { 'idempotency-key': 'triage-on-a-schedule' },
      payload: {
        title: 'Triage on a schedule',
        trigger: {
          kind: 'schedule',
          schedule: { kind: 'interval', minutes: 15 },
        },
        action: {
          kind: 'signal_triage',
          response: 'investigate_and_propose',
          disclosure: 'minimized_signal_evidence',
        },
      },
    });
    assert.equal(mismatched.statusCode, 422, mismatched.body);

    const unknownProject = await app.inject({
      method: 'POST',
      url: '/v1/routines',
      headers: { 'idempotency-key': 'triage-unknown-project' },
      payload: {
        title: 'Triage an unregistered project',
        trigger: {
          kind: 'external_signal',
          integrationId: 'github',
          projectId: 'project_missing',
          categories: ['failed_check'],
        },
        action: {
          kind: 'signal_triage',
          response: 'investigate_and_propose',
          disclosure: 'minimized_signal_evidence',
        },
        limits: {
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          maxOccurrencesPerDay: 5,
          maxTotalOccurrences: 50,
        },
      },
    });
    assert.equal(unknownProject.statusCode, 404, unknownProject.body);
    assert.equal(
      unknownProject.json<{ error: { code: string } }>().error.code,
      'awareness_project_not_found',
    );
  });

  void it('creates through conversation, approves exact authority, executes, and supports pause/resume', async () => {
    const app = createApp(config(), { logger: false });
    apps.push(app);
    const conversation = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'routine-conversation' },
      payload: { title: 'Routine journey' },
    });
    assert.equal(conversation.statusCode, 201, conversation.body);
    const conversationId = conversation.json<{ id: string }>().id;
    const message = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'routine-message' },
      payload: {
        content: 'Every day at 08:00 check test-machine test-service health',
      },
    });
    assert.equal(message.statusCode, 202, message.body);
    const task = message.json<{ runId: string }>();
    let settled: { runStatus: string; failure?: unknown } | undefined;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/runs/${task.runId}`,
      });
      const body = response.json<{ runStatus: string; failure?: unknown }>();
      if (['succeeded', 'failed', 'rejected'].includes(body.runStatus)) {
        settled = body;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(settled?.runStatus, 'succeeded', JSON.stringify(settled));
    const list = await app.inject({ method: 'GET', url: '/v1/routines' });
    assert.equal(list.statusCode, 200, list.body);
    const routine = list.json<{
      routines: {
        id: string;
        status: string;
        approval: {
          effect: { authority: { controlMachineServices: boolean } };
        };
      }[];
    }>().routines[0];
    assert.ok(routine);
    assert.equal(routine.status, 'awaiting_approval');
    assert.equal(
      routine.approval.effect.authority.controlMachineServices,
      false,
    );

    const listMessage = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'routine-list-message' },
      payload: { content: 'List my routines' },
    });
    assert.equal(listMessage.statusCode, 202, listMessage.body);
    const listRunId = listMessage.json<{ runId: string }>().runId;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/runs/${listRunId}`,
      });
      if (response.json<{ runStatus: string }>().runStatus === 'succeeded')
        break;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    const listedConversation = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    const listedReply = listedConversation
      .json<{ messages: { role: string; content: string }[] }>()
      .messages.findLast(({ role }) => role === 'vera');
    assert.match(listedReply?.content ?? '', /Daily machine health check/u);
    assert.match(listedReply?.content ?? '', new RegExp(routine.id, 'u'));

    const attention = await app.inject({ method: 'GET', url: '/v1/attention' });
    assert.equal(
      attention.json<{ items: { reason: string }[] }>().items[0]?.reason,
      'routine_approval_required',
    );
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/routines/${routine.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);
    assert.equal(approved.json<{ status: string }>().status, 'active');

    const run = await app.inject({
      method: 'POST',
      url: `/v1/routines/${routine.id}/runs`,
      headers: { 'idempotency-key': 'routine-run-now' },
    });
    assert.equal(run.statusCode, 202, run.body);
    const completed = await waitForRoutineRun(app, routine.id);
    assert.equal(completed.result?.outcome, 'healthy');
    const fetchedRun = await app.inject({
      method: 'GET',
      url: `/v1/routine-runs/${run.json<{ id: string }>().id}`,
    });
    assert.equal(fetchedRun.statusCode, 200, fetchedRun.body);
    assert.equal(fetchedRun.json<{ status: string }>().status, 'succeeded');
    const quiet = await app.inject({ method: 'GET', url: '/v1/attention' });
    assert.equal(
      quiet.json<{ items: unknown[] }>().items.length,
      0,
      quiet.body,
    );

    const paused = await app.inject({
      method: 'POST',
      url: `/v1/routines/${routine.id}/pause`,
    });
    assert.equal(paused.json<{ status: string }>().status, 'paused');
    const resumed = await app.inject({
      method: 'POST',
      url: `/v1/routines/${routine.id}/resume`,
    });
    assert.equal(resumed.json<{ status: string }>().status, 'active');
  });
});
