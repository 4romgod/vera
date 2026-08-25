import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VeraApiError, VeraClient } from '../src/index.ts';

void describe('Vera HTTP client', () => {
  void it('sends idempotent task submissions and validates task identity', async () => {
    let request:
      | {
          input: Parameters<typeof fetch>[0];
          init?: Parameters<typeof fetch>[1];
        }
      | undefined;
    const client = new VeraClient({
      baseUrl: 'http://vera.test/',
      fetch: (input, init) => {
        request = { input, ...(init === undefined ? {} : { init }) };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              taskStatus: 'active',
              runStatus: 'deciding',
              message: 'hello',
              createdAt: '2026-08-25T00:00:00.000Z',
              updatedAt: '2026-08-25T00:00:00.000Z',
              links: { task: '/task', run: '/run', events: '/events' },
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });

    const task = await client.submitTask({
      message: 'hello',
      projectId: 'project_test',
      idempotencyKey: 'client-test-key',
    });

    assert.equal(task.runStatus, 'deciding');
    assert.ok(request);
    assert.equal(request.input, 'http://vera.test/v1/tasks');
    assert.equal(
      new Headers(request.init?.headers).get('idempotency-key'),
      'client-test-key',
    );
  });

  void it('normalizes Vera error envelopes', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'task_not_found', message: 'Missing task.' },
            }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await assert.rejects(client.getTask('task_missing'), (error) => {
      assert.ok(error instanceof VeraApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'task_not_found');
      return true;
    });
  });

  void it('rejects an unknown run status at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              runStatus: 'mystery',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await assert.rejects(client.getRun('run_test'), /invalid task resource/u);
  });

  void it('polls until a caller-defined approval boundary', async () => {
    let calls = 0;
    const client = new VeraClient({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              taskStatus: 'active',
              runStatus: calls === 1 ? 'deciding' : 'awaiting_approval',
              message: 'plan',
              createdAt: '2026-08-25T00:00:00.000Z',
              updatedAt: '2026-08-25T00:00:00.000Z',
              links: { task: '/task', run: '/run', events: '/events' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });

    const task = await client.waitForRun('run_test', {
      intervalMs: 1,
      until: (current) => current.runStatus === 'awaiting_approval',
    });

    assert.equal(task.runStatus, 'awaiting_approval');
    assert.equal(calls, 2);
  });

  void it('waits for a terminal conversation reply to be projected', async () => {
    let calls = 0;
    const client = new VeraClient({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              taskId: 'task_test',
              runId: 'run_test',
              taskStatus: 'completed',
              runStatus: 'succeeded',
              conversationId: 'conversation_test',
              conversationReply: {
                status: calls === 1 ? 'pending' : 'projected',
                messageId: 'message_reply_test',
                createdAt: '2026-08-25T00:00:00.000Z',
                ...(calls === 1
                  ? {}
                  : { projectedAt: '2026-08-25T00:00:01.000Z' }),
              },
              message: 'hello',
              createdAt: '2026-08-25T00:00:00.000Z',
              updatedAt: '2026-08-25T00:00:00.000Z',
              links: { task: '/task', run: '/run', events: '/events' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });

    const completed = await client.waitForRun('run_test', { intervalMs: 1 });

    assert.equal(completed.conversationReply?.status, 'projected');
    assert.equal(calls, 2);
  });

  void it('applies the polling timeout to an in-flight HTTP request', async () => {
    const client = new VeraClient({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true },
          );
        }),
    });

    const keepEventLoopAlive = setTimeout(() => undefined, 50);
    try {
      await assert.rejects(
        client.waitForRun('run_stuck', { timeoutMs: 5 }),
        /Timed out waiting for run run_stuck/u,
      );
    } finally {
      clearTimeout(keepEventLoopAlive);
    }
  });
});
