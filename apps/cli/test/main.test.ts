import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ArtifactResource,
  ChangeApplicationResource,
  ConversationResource,
  SoftwareChangePublicationResource,
  TaskResource,
  VeraApi,
} from '@vera/client';

import { runCli } from '../src/main.ts';

function task(
  runStatus: TaskResource['runStatus'],
  extra: Partial<TaskResource> = {},
): TaskResource {
  return {
    schemaVersion: 1,
    taskId: 'task_test',
    runId: 'run_test',
    taskStatus: runStatus === 'succeeded' ? 'completed' : 'active',
    runStatus,
    message: 'plan it',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    links: { task: '/task', run: '/run', events: '/events' },
    ...extra,
  };
}

function fakeApi(overrides: Partial<VeraApi>): VeraApi {
  const unavailable = (): never => {
    throw new Error('Unexpected client call.');
  };
  return {
    transcribeAudio: unavailable,
    uploadAttachment: unavailable,
    getAttachment: unavailable,
    attachmentPreviewUrl: unavailable,
    listCapabilities: unavailable,
    listPersonalTasks: unavailable,
    getPersonalTask: unavailable,
    listReminders: unavailable,
    getReminder: unavailable,
    listMemories: unavailable,
    getMemory: unavailable,
    listNotifications: unavailable,
    streamNotifications: unavailable,
    registerProject: unavailable,
    listProjects: unavailable,
    getProject: unavailable,
    createConversation: unavailable,
    listConversations: unavailable,
    getConversation: unavailable,
    appendMessage: unavailable,
    submitTask: unavailable,
    getTask: unavailable,
    getRun: unavailable,
    getRunEvents: unavailable,
    decideApproval: unavailable,
    cancelRun: unavailable,
    getArtifact: unavailable,
    createChangeApplication: unavailable,
    listChangeApplicationsForArtifact: unavailable,
    getChangeApplication: unavailable,
    getChangeApplicationEvents: unavailable,
    decideChangeApplication: unavailable,
    cancelChangeApplication: unavailable,
    waitForChangeApplication: unavailable,
    createSoftwareChangePublication: unavailable,
    listSoftwareChangePublicationsForApplication: unavailable,
    getSoftwareChangePublication: unavailable,
    getSoftwareChangePublicationEvents: unavailable,
    decideSoftwareChangePublication: unavailable,
    cancelSoftwareChangePublication: unavailable,
    waitForSoftwareChangePublication: unavailable,
    waitForRun: unavailable,
    ...overrides,
  };
}

function changeApplication(
  status: ChangeApplicationResource['status'],
): ChangeApplicationResource {
  return {
    schemaVersion: 1,
    version: 1,
    id: 'application_test',
    status,
    sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
    project: { id: 'project_test', displayName: 'Vera' },
    approval: {
      id: 'approval_application',
      status: status === 'awaiting_approval' ? 'pending' : 'approved',
      reason: 'software_change_application',
      sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
      project: { id: 'project_test', displayName: 'Vera' },
      effect: {
        adapterId: 'local_git_worktree',
        baseRevision: 'b'.repeat(40),
        branchName: 'vera/change-test',
        workspacePath: '/managed/application_test',
        patchSha256: 'c'.repeat(64),
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
  };
}

function publication(
  status: SoftwareChangePublicationResource['status'],
): SoftwareChangePublicationResource {
  return {
    schemaVersion: 1,
    version: 1,
    id: 'publication_test',
    status,
    sourceApplication: {
      id: 'application_test',
      effectId: 'effect_application',
      version: 4,
    },
    project: { id: 'project_test', displayName: 'Vera' },
    approval: {
      id: 'approval_publication',
      status: status === 'awaiting_approval' ? 'pending' : 'approved',
      reason: 'software_change_publication',
      effect: {
        adapterId: 'github_gh_cli',
        repository: { remoteName: 'origin', owner: '4romgod', name: 'vera' },
        baseRevision: 'a'.repeat(40),
        baseBranch: 'main',
        baseBranchRevision: 'a'.repeat(40),
        headBranch: 'vera/change-test',
        workspacePath: '/managed/application_test',
        treeRevision: 'b'.repeat(40),
        files: [],
        author: { name: 'Vera Test', email: 'vera@example.test' },
        commitMessage: 'Publish change',
        pullRequest: { title: 'Publish change', body: 'Body', draft: true },
        authority: {
          commit: 'create_one',
          push: 'create_or_verify_head',
          pullRequest: 'create_or_verify',
          directBasePush: false,
          forcePush: false,
        },
      },
      requestedAt: '2026-08-27T00:00:00.000Z',
    },
    effect: {
      id: 'effect_publication',
      status: status === 'succeeded' ? 'succeeded' : 'pending',
    },
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    links: { publication: '/publication', events: '/events' },
  };
}

void describe('Vera CLI', () => {
  void it('lists governed memory through the shared client', async () => {
    const output: string[] = [];
    let options: Parameters<VeraApi['listMemories']>[0];
    const exit = await runCli(
      [
        'memory',
        'list',
        '--kind',
        'preference',
        '--project',
        'project_vera',
        '--limit',
        '5',
      ],
      {
        client: fakeApi({
          listMemories: (input) => {
            options = input;
            return Promise.resolve({ schemaVersion: 1, memories: [] });
          },
        }),
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
      },
    );
    assert.equal(exit, 0);
    assert.deepEqual(options, {
      kind: 'preference',
      scope: { kind: 'project', projectId: 'project_vera' },
      limit: 5,
    });
    assert.match(output.join(''), /"memories"/u);
  });

  void it('lists durable personal tasks through the shared client', async () => {
    const output: string[] = [];
    let options: Parameters<VeraApi['listPersonalTasks']>[0];
    const exit = await runCli(
      ['personal-task', 'list', '--status', 'completed', '--limit', '5'],
      {
        client: fakeApi({
          listPersonalTasks: (input) => {
            options = input;
            return Promise.resolve({
              schemaVersion: 1,
              tasks: [
                {
                  schemaVersion: 1,
                  id: 'personal_task_test',
                  title: 'Buy milk',
                  status: 'completed',
                  createdAt: '2026-08-26T10:00:00.000Z',
                  updatedAt: '2026-08-26T11:00:00.000Z',
                  completedAt: '2026-08-26T11:00:00.000Z',
                },
              ],
            });
          },
        }),
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
      },
    );

    assert.equal(exit, 0);
    assert.deepEqual(options, { status: 'completed', limit: 5 });
    assert.match(output.join(''), /personal_task_test/u);
  });

  void it('lists reminders and watches notification events', async () => {
    const output: string[] = [];
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
      deliveredAt: reminder.updatedAt,
      status: 'unread' as const,
      channel: 'vera_inbox' as const,
    };
    let reminderOptions: Parameters<VeraApi['listReminders']>[0];
    const client = fakeApi({
      listReminders: (options) => {
        reminderOptions = options;
        return Promise.resolve({ schemaVersion: 1, reminders: [reminder] });
      },
      async *streamNotifications() {
        await Promise.resolve();
        yield { cursor: 'opaque-cursor', notification };
      },
    });

    assert.equal(
      await runCli(
        ['reminder', 'list', '--status', 'delivered', '--limit', '5'],
        {
          client,
          stdout: {
            write: (value) => {
              output.push(String(value));
              return true;
            },
          },
        },
      ),
      0,
    );
    assert.deepEqual(reminderOptions, { status: 'delivered', limit: 5 });
    assert.equal(
      await runCli(['notification', 'watch'], {
        client,
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
      }),
      0,
    );
    assert.match(output.join(''), /opaque-cursor/u);
    assert.match(output.join(''), /notification_test/u);
  });

  void it('lists the runtime capability catalog', async () => {
    const output: string[] = [];
    const client = fakeApi({
      listCapabilities: () =>
        Promise.resolve({
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
              acceptedInputArtifacts: [],
              authority: {
                approval: 'always',
                projectContext: 'none',
                networkAccess: 'public_web_via_provider',
                dataClasses: ['owner_request', 'public_web'],
                sideEffects: ['third_party_disclosure', 'public_network_read'],
                credentials: 'server_managed',
                maxWebSearchCalls: 4,
              },
              enabled: true,
            },
          ],
        }),
    });

    const exitCode = await runCli(['capability', 'list'], {
      client,
      stdout: {
        write: (value) => {
          output.push(String(value));
          return true;
        },
      },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
    assert.match(output.join(''), /"web_research"/u);
    assert.match(output.join(''), /"public_web_via_provider"/u);
  });

  void it('shows exact disclosure before explicit plan approval', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const calls: string[] = [];
    const pending = task('awaiting_approval', {
      approval: {
        id: 'approval_test',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'development_planning', version: 1 },
        proposedArguments: { objective: 'plan it' },
        destination: {
          schemaVersion: 1,
          adapterId: 'codex_cli',
          provider: 'openai',
          transport: 'local_process',
          dataBoundary: 'third_party',
        },
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
    });
    const completed = task('succeeded', {
      output: {
        kind: 'development_plan',
        artifact: {
          id: 'artifact_test',
          version: 1,
          type: 'implementation_plan',
          mediaType: 'application/vnd.vera.implementation-plan+json',
          sha256: 'a'.repeat(64),
          byteLength: 10,
        },
      },
    });
    const artifact = { id: 'artifact_test' } as ArtifactResource;
    assert.ok(pending.approval);
    const approvedPending = task('awaiting_approval', {
      approval: { ...pending.approval, status: 'approved' },
    });
    let waits = 0;
    const client = fakeApi({
      submitTask: () => {
        calls.push('submit');
        return Promise.resolve(task('deciding'));
      },
      waitForRun: (_runId, options) => {
        calls.push('wait');
        waits += 1;
        if (waits === 2) {
          assert.equal(options?.until?.(approvedPending), false);
          assert.equal(options.until(completed), true);
        }
        return Promise.resolve(waits === 1 ? pending : completed);
      },
      decideApproval: (_approvalId, decision) => {
        calls.push(`decide:${decision}`);
        assert.match(output.join(''), /codex_cli/u);
        return Promise.resolve(task('awaiting_approval'));
      },
      getArtifact: () => {
        calls.push('artifact');
        return Promise.resolve(artifact);
      },
    });

    const exitCode = await runCli(
      [
        'plan',
        '--project',
        'project_test',
        '--message',
        'plan it',
        '--approve',
      ],
      {
        client,
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
        stderr: {
          write: (value) => {
            errors.push(String(value));
            return true;
          },
        },
        createIdempotencyKey: () => 'cli-test-key',
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      'submit',
      'wait',
      'decide:approved',
      'wait',
      'artifact',
    ]);
    assert.match(
      errors.join(''),
      /Approval recorded\. Waiting for run run_test to finish/u,
    );
  });

  void it('rejects an interactive plan when confirmation is denied', async () => {
    const pending = task('awaiting_approval', {
      approval: {
        id: 'approval_test',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'development_planning', version: 1 },
        proposedArguments: {},
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
    });
    let decision: string | undefined;
    const client = fakeApi({
      submitTask: () => Promise.resolve(task('deciding')),
      waitForRun: () => Promise.resolve(pending),
      decideApproval: (_approvalId, selected) => {
        decision = selected;
        return Promise.resolve(task('rejected'));
      },
    });

    const exitCode = await runCli(
      ['plan', '--project', 'project_test', '--message', 'plan it'],
      {
        client,
        stdout: { write: () => true },
        stderr: { write: () => true },
        confirm: () => Promise.resolve(false),
      },
    );

    assert.equal(exitCode, 2);
    assert.equal(decision, 'rejected');
  });

  void it('approves only a software-change proposal from the change command', async () => {
    const calls: string[] = [];
    const pending = task('awaiting_approval', {
      approval: {
        id: 'approval_change',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'software_change', version: 1 },
        proposedArguments: { objective: 'implement it' },
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
    });
    const completed = task('succeeded', {
      output: {
        kind: 'software_change',
        artifact: {
          id: 'artifact_change',
          version: 1,
          type: 'software_change',
          mediaType: 'application/vnd.vera.software-change+json',
          sha256: 'b'.repeat(64),
          byteLength: 20,
        },
      },
    });
    let waits = 0;
    const client = fakeApi({
      submitTask: () => Promise.resolve(task('deciding')),
      waitForRun: () => {
        waits += 1;
        return Promise.resolve(waits === 1 ? pending : completed);
      },
      decideApproval: (_approvalId, decision) => {
        calls.push(decision);
        return Promise.resolve(task('awaiting_approval'));
      },
      getArtifact: () =>
        Promise.resolve({ id: 'artifact_change' } as ArtifactResource),
    });

    const exitCode = await runCli(
      [
        'change',
        '--project',
        'project_test',
        '--message',
        'implement it',
        '--approve',
      ],
      {
        client,
        stdout: { write: () => true },
        stderr: { write: () => true },
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, ['approved']);
  });

  void it('runs approved research without adding project authority', async () => {
    const output: string[] = [];
    let submittedInput: Parameters<VeraApi['submitTask']>[0] | undefined;
    const pending = task('awaiting_approval', {
      approval: {
        id: 'approval_research',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'web_research', version: 1 },
        proposedArguments: { objective: 'research durable execution' },
        authority: {
          approval: 'always',
          projectContext: 'none',
          networkAccess: 'public_web_via_provider',
          dataClasses: ['owner_request', 'public_web'],
          sideEffects: ['third_party_disclosure', 'public_network_read'],
          credentials: 'server_managed',
          maxWebSearchCalls: 4,
        },
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
    });
    const completed = task('succeeded', {
      output: {
        kind: 'research_report',
        artifact: {
          id: 'artifact_research',
          version: 1,
          type: 'research_report',
          mediaType: 'application/vnd.vera.research-report+json',
          sha256: 'c'.repeat(64),
          byteLength: 30,
        },
      },
    });
    let waits = 0;
    const client = fakeApi({
      submitTask: (input) => {
        submittedInput = input;
        return Promise.resolve(task('deciding'));
      },
      waitForRun: () => {
        waits += 1;
        return Promise.resolve(waits === 1 ? pending : completed);
      },
      decideApproval: () => Promise.resolve(task('awaiting_approval')),
      getArtifact: () =>
        Promise.resolve({ id: 'artifact_research' } as ArtifactResource),
    });

    const exitCode = await runCli(
      [
        'research',
        '--message',
        'research durable execution',
        '--key',
        'research-key',
        '--approve',
      ],
      {
        client,
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
        stderr: { write: () => true },
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(submittedInput, {
      message: 'research durable execution',
      idempotencyKey: 'research-key',
    });
    assert.match(output.join(''), /"projectContext": "none"/u);
    assert.match(output.join(''), /"research_report"/u);
  });

  void it('discloses and applies an exact software-change artifact through the controlled effect flow', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const calls: string[] = [];
    const client = fakeApi({
      createChangeApplication: (input) => {
        calls.push(`create:${input.artifactId}`);
        return Promise.resolve(changeApplication('awaiting_approval'));
      },
      decideChangeApplication: (input) => {
        calls.push(`decide:${input.decision}`);
        assert.match(output.join(''), /local_git_worktree/u);
        assert.match(output.join(''), /\/managed\/application_test/u);
        return Promise.resolve(changeApplication('approved'));
      },
      waitForChangeApplication: () => {
        calls.push('wait');
        return Promise.resolve(changeApplication('succeeded'));
      },
    });

    const exitCode = await runCli(
      ['change', 'apply', '--artifact', 'artifact_test', '--approve'],
      {
        client,
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
        stderr: {
          write: (value) => {
            errors.push(String(value));
            return true;
          },
        },
        createIdempotencyKey: () => 'application-test-key',
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      'create:artifact_test',
      'decide:approved',
      'wait',
    ]);
    assert.match(
      errors.join(''),
      /Waiting for change application application_test/u,
    );
  });

  void it('discloses and approves the exact commit, push, and pull request publication', async () => {
    const output: string[] = [];
    const calls: string[] = [];
    const client = fakeApi({
      createSoftwareChangePublication: (input) => {
        calls.push(
          `create:${input.applicationId}:${String(input.pullRequest.draft)}`,
        );
        return Promise.resolve(publication('awaiting_approval'));
      },
      decideSoftwareChangePublication: (input) => {
        assert.match(output.join(''), /directBasePush/u);
        assert.match(output.join(''), /github_gh_cli/u);
        calls.push(`decide:${input.decision}`);
        return Promise.resolve(publication('approved'));
      },
      waitForSoftwareChangePublication: () => {
        calls.push('wait');
        return Promise.resolve(publication('succeeded'));
      },
    });

    const exitCode = await runCli(
      [
        'change',
        'publish',
        '--application',
        'application_test',
        '--commit-message',
        'Publish change',
        '--pr-title',
        'Publish change',
        '--pr-body',
        'Body',
        '--draft',
        '--approve',
      ],
      {
        client,
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
        stderr: { write: () => true },
        createIdempotencyKey: () => 'publication-test-key',
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      'create:application_test:true',
      'decide:approved',
      'wait',
    ]);
  });

  void it('never auto-approves a capability that differs from the command', async () => {
    const pending = task('awaiting_approval', {
      approval: {
        id: 'approval_wrong',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'software_change', version: 1 },
        proposedArguments: { objective: 'unexpected change' },
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
    });
    let decisions = 0;
    const client = fakeApi({
      submitTask: () => Promise.resolve(task('deciding')),
      waitForRun: () => Promise.resolve(pending),
      decideApproval: () => {
        decisions += 1;
        return Promise.resolve(task('succeeded'));
      },
    });

    await assert.rejects(
      runCli(
        [
          'plan',
          '--project',
          'project_test',
          '--message',
          'plan it',
          '--approve',
        ],
        {
          client,
          stdout: { write: () => true },
          stderr: { write: () => true },
        },
      ),
      /plan command only permits development_planning/u,
    );
    assert.equal(decisions, 0);
  });

  void it('appends a conversation message through the shared client', async () => {
    let received: Parameters<VeraApi['appendMessage']>[0] | undefined;
    const client = fakeApi({
      appendMessage: (input) => {
        received = input;
        return Promise.resolve(task('deciding'));
      },
    });

    const exitCode = await runCli(
      [
        'conversation',
        'message',
        'conversation_test',
        '--content',
        'Plan it.',
        '--project',
        'project_test',
      ],
      {
        client,
        stdout: { write: () => true },
        stderr: { write: () => true },
        createIdempotencyKey: () => 'message-test-key',
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(received, {
      conversationId: 'conversation_test',
      content: 'Plan it.',
      projectId: 'project_test',
      idempotencyKey: 'message-test-key',
    });
  });

  void it('creates a conversation and prints its durable Vera reply', async () => {
    const output: string[] = [];
    const calls: string[] = [];
    const emptyConversation: ConversationResource = {
      schemaVersion: 1,
      id: 'conversation_test',
      title: 'Explain Vera',
      status: 'active',
      messages: [],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const completed = task('succeeded', {
      conversationId: 'conversation_test',
      conversationReply: {
        status: 'projected',
        messageId: 'message_reply_test',
        createdAt: '2026-08-25T00:00:00.000Z',
        projectedAt: '2026-08-25T00:00:01.000Z',
      },
    });
    const client = fakeApi({
      createConversation: (input) => {
        calls.push(`create:${input.title ?? ''}`);
        return Promise.resolve(emptyConversation);
      },
      appendMessage: (input) => {
        calls.push(`append:${input.content}`);
        return Promise.resolve(
          task('deciding', { conversationId: 'conversation_test' }),
        );
      },
      waitForRun: (_runId, options) => {
        calls.push('wait');
        assert.equal(options?.until?.(completed), true);
        return Promise.resolve(completed);
      },
      getConversation: () => {
        calls.push('get');
        return Promise.resolve({
          ...emptyConversation,
          messages: [
            {
              id: 'message_owner_test',
              role: 'owner',
              content: 'Explain Vera',
              taskId: 'task_test',
              createdAt: '2026-08-25T00:00:00.000Z',
            },
            {
              id: 'message_reply_test',
              role: 'vera',
              content: 'Vera orchestrates work.',
              taskId: 'task_test',
              createdAt: '2026-08-25T00:00:01.000Z',
            },
          ],
        });
      },
    });

    const exitCode = await runCli(['chat', '--message', '   Explain Vera   '], {
      client,
      stdout: {
        write: (value) => {
          output.push(String(value));
          return true;
        },
      },
      stderr: { write: () => true },
      createIdempotencyKey: (() => {
        let sequence = 0;
        return () => `chat-key-${String(++sequence)}`;
      })(),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      'create:Explain Vera',
      'append:Explain Vera',
      'wait',
      'get',
    ]);
    assert.match(output.join(''), /Vera orchestrates work\./u);
  });

  void it('reviews every approval in a multi-step chat goal', async () => {
    const output: string[] = [];
    const calls: string[] = [];
    const conversation: ConversationResource = {
      schemaVersion: 1,
      id: 'conversation_goal',
      title: 'Plan and implement',
      status: 'active',
      messages: [],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const planningApproval = task('awaiting_approval', {
      conversationId: conversation.id,
      approval: {
        id: 'approval_plan',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'development_planning', version: 1 },
        proposedArguments: { objective: 'Plan the change.' },
        requestedAt: '2026-08-25T00:00:00.000Z',
      },
    });
    const changeApproval = task('awaiting_approval', {
      conversationId: conversation.id,
      approval: {
        id: 'approval_change',
        status: 'pending',
        reason: 'specialist_capability_invocation',
        capability: { name: 'software_change', version: 1 },
        proposedArguments: { objective: 'Implement the change.' },
        inputArtifacts: [
          {
            id: 'artifact_plan',
            version: 1,
            type: 'implementation_plan',
            mediaType: 'application/vnd.vera.implementation-plan+json',
            sha256: 'a'.repeat(64),
            byteLength: 10,
          },
        ],
        decisionEvidence: [
          {
            id: 'artifact_plan',
            version: 1,
            type: 'implementation_plan',
            mediaType: 'application/vnd.vera.implementation-plan+json',
            sha256: 'a'.repeat(64),
            byteLength: 10,
          },
        ],
        requestedAt: '2026-08-25T00:00:01.000Z',
      },
    });
    const terminal = task('succeeded', { conversationId: conversation.id });
    const completed = task('succeeded', {
      conversationId: conversation.id,
      conversationReply: {
        status: 'projected',
        messageId: 'message_goal_reply',
        createdAt: '2026-08-25T00:00:02.000Z',
        projectedAt: '2026-08-25T00:00:03.000Z',
      },
    });
    let wait = 0;
    const client = fakeApi({
      createConversation: () => Promise.resolve(conversation),
      appendMessage: () => Promise.resolve(task('deciding')),
      waitForRun: () => {
        wait += 1;
        return Promise.resolve(
          wait === 1
            ? planningApproval
            : wait === 2
              ? changeApproval
              : completed,
        );
      },
      decideApproval: (approvalId) => {
        calls.push(approvalId);
        return Promise.resolve(task('executing'));
      },
      getConversation: () =>
        Promise.resolve({
          ...conversation,
          messages: [
            {
              id: 'message_goal_reply',
              role: 'vera',
              content: 'I completed both approved steps.',
              taskId: terminal.taskId,
              createdAt: '2026-08-25T00:00:03.000Z',
            },
          ],
        }),
    });
    let confirmations = 0;

    const exitCode = await runCli(
      ['chat', '--message', 'Plan and implement the change.'],
      {
        client,
        stdout: {
          write: (value) => {
            output.push(String(value));
            return true;
          },
        },
        stderr: { write: () => true },
        confirm: () => {
          confirmations += 1;
          return Promise.resolve(true);
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(confirmations, 2);
    assert.deepEqual(calls, ['approval_plan', 'approval_change']);
    assert.match(output.join(''), /artifact_plan/u);
    assert.match(output.join(''), /decisionEvidence/u);
    assert.match(output.join(''), /I completed both approved steps\./u);
  });

  void it('rejects an all-whitespace chat message before calling the API', async () => {
    let called = false;
    const client = fakeApi({
      createConversation: () => {
        called = true;
        return Promise.reject(new Error('must not be called'));
      },
    });

    await assert.rejects(
      runCli(['chat', '--message', '   '], {
        client,
        stdout: { write: () => true },
        stderr: { write: () => true },
      }),
      /--message must contain non-whitespace text/u,
    );
    assert.equal(called, false);
  });

  void it('rejects invalid wait timeouts before calling the API', async () => {
    await assert.rejects(
      runCli(['run', 'wait', 'run_test', '--timeout-ms', 'not-a-number'], {
        client: fakeApi({}),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }),
      /--timeout-ms must be a positive integer/u,
    );
  });
});
