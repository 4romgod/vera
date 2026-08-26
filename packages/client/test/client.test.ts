import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VeraApiError, VeraClient } from '../src/index.ts';

void describe('Vera HTTP client', () => {
  void it('loads and validates the capability catalog', async () => {
    let requestedUrl = '';
    const client = new VeraClient({
      baseUrl: 'http://vera.test/',
      fetch: (input) => {
        requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return Promise.resolve(
          Response.json({
            schemaVersion: 1,
            capabilities: [
              {
                name: 'web_research',
                version: 1,
                description: 'Research public sources.',
                effect: 'external',
                artifact: {
                  type: 'research_report',
                  mediaType: 'application/vnd.vera.research-report+json',
                },
                authority: {
                  approval: 'always',
                  projectContext: 'none',
                  networkAccess: 'public_web_via_provider',
                  dataClasses: ['owner_request', 'public_web'],
                  sideEffects: [
                    'third_party_disclosure',
                    'public_network_read',
                  ],
                  credentials: 'server_managed',
                  maxWebSearchCalls: 4,
                },
                enabled: true,
              },
            ],
          }),
        );
      },
    });

    const catalog = await client.listCapabilities();

    assert.equal(requestedUrl, 'http://vera.test/v1/capabilities');
    assert.equal(catalog.capabilities[0]?.name, 'web_research');
  });

  void it('rejects an invalid capability catalog at the client boundary', async () => {
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          Response.json({ schemaVersion: 1, capabilities: [{ name: 42 }] }),
        ),
    });

    await assert.rejects(
      client.listCapabilities(),
      /invalid capability catalog/u,
    );
  });

  void it('lists and validates owner-scoped personal tasks', async () => {
    let requestedUrl = '';
    const task = {
      schemaVersion: 1 as const,
      id: 'personal_task_test',
      title: 'Buy milk',
      status: 'open' as const,
      createdAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:00:00.000Z',
    };
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return Promise.resolve(
          Response.json(
            requestedUrl.includes('/personal-tasks/personal_task_test')
              ? task
              : { schemaVersion: 1, tasks: [task] },
          ),
        );
      },
    });

    const listed = await client.listPersonalTasks({
      status: 'open',
      limit: 10,
    });
    assert.equal(
      requestedUrl,
      'http://vera.test/v1/personal-tasks?status=open&limit=10',
    );
    assert.equal(listed.tasks[0]?.title, 'Buy milk');
    assert.equal(
      (await client.getPersonalTask('personal_task_test')).id,
      'personal_task_test',
    );
  });

  void it('lists reminders and resumes notification delivery from an opaque cursor', async () => {
    const reminder = {
      schemaVersion: 1 as const,
      id: 'reminder_test',
      message: 'Stand up',
      scheduledFor: '2026-08-26T10:00:00.000Z',
      timeZone: 'Africa/Johannesburg',
      status: 'delivered' as const,
      createdAt: '2026-08-26T09:00:00.000Z',
      updatedAt: '2026-08-26T10:00:00.000Z',
    };
    const notification = {
      schemaVersion: 1 as const,
      id: 'notification_test',
      reminderId: reminder.id,
      message: reminder.message,
      scheduledFor: reminder.scheduledFor,
      deliveredAt: '2026-08-26T10:00:00.000Z',
      status: 'unread' as const,
      channel: 'vera_inbox' as const,
    };
    const requestedUrls: string[] = [];
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requestedUrls.push(url);
        if (url.includes('/notifications')) {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              notifications: [notification],
              nextCursor: 'opaque-cursor',
            }),
          );
        }
        return Promise.resolve(
          Response.json(
            url.includes('/reminders/reminder_test')
              ? reminder
              : { schemaVersion: 1, reminders: [reminder] },
          ),
        );
      },
    });

    assert.equal(
      (await client.listReminders({ status: 'delivered', limit: 5 }))
        .reminders[0]?.id,
      reminder.id,
    );
    assert.equal((await client.getReminder(reminder.id)).id, reminder.id);
    const page = await client.listNotifications({
      after: 'prior-cursor',
      limit: 10,
    });
    assert.equal(page.notifications[0]?.id, notification.id);
    assert.equal(page.nextCursor, 'opaque-cursor');
    assert.ok(
      requestedUrls.includes(
        'http://vera.test/v1/notifications?after=prior-cursor&limit=10',
      ),
    );
  });

  void it('parses chunked notification server-sent events', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'retry: 1000\n\nevent: notification\nid: cursor\ndata:',
          ),
        );
        controller.enqueue(
          encoder.encode(
            ' {"schemaVersion":1,"id":"notification_test","reminderId":"reminder_test","message":"Stand up","scheduledFor":"2026-08-26T10:00:00.000Z","deliveredAt":"2026-08-26T10:00:00.000Z","status":"unread","channel":"vera_inbox"}\n\n',
          ),
        );
        controller.close();
      },
    });
    const client = new VeraClient({
      fetch: () =>
        Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
    });

    const received = [];
    for await (const notification of client.streamNotifications()) {
      received.push(notification);
    }
    assert.equal(received.length, 1);
    const event = received[0];
    assert.ok(event);
    assert.equal(event.cursor, 'cursor');
    assert.equal(event.notification.id, 'notification_test');
  });

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

  void it('creates and polls a controlled change application', async () => {
    const requests: string[] = [];
    let polls = 0;
    const application = (
      status: 'awaiting_approval' | 'applying' | 'succeeded',
    ) => ({
      schemaVersion: 1,
      version: 1,
      id: 'application_test',
      status,
      sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
      project: { id: 'project_test', displayName: 'Test' },
      approval: {
        id: 'approval_test',
        status: status === 'awaiting_approval' ? 'pending' : 'approved',
        reason: 'software_change_application',
        sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
        project: { id: 'project_test', displayName: 'Test' },
        effect: {
          adapterId: 'local_git_worktree',
          baseRevision: 'a'.repeat(40),
          branchName: 'vera/change-test',
          workspacePath: '/managed/application_test',
          patchSha256: 'b'.repeat(64),
          staged: true,
          files: [],
        },
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
      effect: {
        id: 'effect_test',
        status: status === 'succeeded' ? 'succeeded' : 'pending',
      },
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      links: { application: '/application', events: '/events' },
    });
    const client = new VeraClient({
      baseUrl: 'http://vera.test',
      fetch: (input, init) => {
        const requestUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push(`${init?.method ?? 'GET'} ${requestUrl}`);
        const isCreate = requestUrl.includes('/artifacts/');
        if (!isCreate) polls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              isCreate
                ? application('awaiting_approval')
                : application(polls === 1 ? 'applying' : 'succeeded'),
            ),
            {
              status: isCreate ? 202 : 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      },
    });

    const created = await client.createChangeApplication({
      artifactId: 'artifact_test',
      idempotencyKey: 'application-key',
    });
    const completed = await client.waitForChangeApplication(created.id, {
      intervalMs: 1,
    });

    assert.equal(created.status, 'awaiting_approval');
    assert.equal(completed.status, 'succeeded');
    assert.equal(polls, 2);
    assert.match(
      requests[0] ?? '',
      /POST .*\/v1\/artifacts\/artifact_test\/applications/u,
    );
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
