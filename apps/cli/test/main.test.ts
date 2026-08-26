import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ArtifactResource,
  ChangeApplicationResource,
  ConversationResource,
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
    listCapabilities: unavailable,
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
    getChangeApplication: unavailable,
    getChangeApplicationEvents: unavailable,
    decideChangeApplication: unavailable,
    cancelChangeApplication: unavailable,
    waitForChangeApplication: unavailable,
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

void describe('Vera CLI', () => {
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
    let waits = 0;
    const client = fakeApi({
      submitTask: () => {
        calls.push('submit');
        return Promise.resolve(task('deciding'));
      },
      waitForRun: () => {
        calls.push('wait');
        waits += 1;
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
