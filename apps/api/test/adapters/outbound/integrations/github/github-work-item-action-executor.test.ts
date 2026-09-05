import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubWorkItemActionExecutor } from '../../../../../src/adapters/outbound/integrations/github/github-work-item-action-executor.ts';
import {
  githubCliProcessEnvironment,
  parseGitHubRepositoryRemote,
  type GitHubCommandRunner,
} from '../../../../../src/adapters/outbound/github/github-cli.ts';
import { IntegrationConnectionSchema } from '../../../../../src/domain/integrations/integration-connection.ts';
import type { ProjectContextBundle } from '../../../../../src/domain/projects/project-context.ts';
import type { Project } from '../../../../../src/domain/projects/project.ts';

const project: Project = {
  schemaVersion: 1,
  id: 'project_test',
  principalId: 'owner_v1',
  registrationKey: 'test',
  displayName: 'Vera',
  normalizedName: 'vera',
  source: { kind: 'local_git', rootPath: '/projects/vera' },
  status: 'active',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const context: ProjectContextBundle = {
  manifest: {
    schemaVersion: 1,
    projectId: project.id,
    sourceKind: 'local_git',
    repository: { provider: 'github', owner: '4romgod', name: 'vera' },
    revision: 'a'.repeat(40),
    generatedAt: '2026-09-05T00:00:00.000Z',
    entries: [],
    totalFiles: 0,
    totalBytes: 0,
    limits: { maxFiles: 10, maxBytes: 1_000, maxFileBytes: 500 },
    exclusions: [],
  },
  documents: [],
};

const connection = IntegrationConnectionSchema.parse({
  schemaVersion: 1,
  version: 1,
  id: 'connection_test',
  requestKey: 'connect-test',
  principalId: 'owner_v1',
  integrationId: 'github',
  adapterId: 'github_gh_cli',
  status: 'active',
  credentialBinding: { kind: 'host_session', host: 'github.com' },
  account: { providerAccountId: '123', login: '4romgod' },
  operations: ['issues_read', 'issues_create'],
  lastVerifiedAt: '2026-09-05T00:00:00.000Z',
  events: [
    {
      schemaVersion: 1,
      id: 'event_test',
      sequence: 1,
      type: 'connection_enabled',
      occurredAt: '2026-09-05T00:00:00.000Z',
      data: {},
    },
  ],
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
});

function rawIssue(body = 'Approved body') {
  return {
    number: 42,
    title: 'Track the connection layer',
    body,
    state: 'OPEN',
    url: 'https://github.com/4romgod/vera/issues/42',
    labels: [{ name: 'enhancement' }],
    author: { login: '4romgod' },
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

function executor(run: GitHubCommandRunner) {
  return new GitHubWorkItemActionExecutor({
    projects: {
      createProject: () => Promise.resolve({ created: false, project }),
      findProjectById: (principalId, projectId) =>
        Promise.resolve(
          principalId === project.principalId && projectId === project.id
            ? project
            : null,
        ),
      listProjects: () => Promise.resolve([project]),
    },
    connections: {
      requireActive: (principalId, integrationId) => {
        assert.equal(principalId, 'owner_v1');
        assert.equal(integrationId, 'github');
        return Promise.resolve(connection);
      },
    },
    run,
  });
}

function baseInput() {
  return {
    principalId: 'owner_v1',
    invocationId: 'invocation_test',
    startedAt: '2026-09-05T00:00:00.000Z',
    recovery: false,
    project: { id: project.id, displayName: project.displayName },
    context,
  };
}

void describe('GitHub work-item adapter', () => {
  void it('keeps unrelated secrets out of GitHub subprocesses and rejects unsafe remotes', () => {
    assert.deepEqual(
      githubCliProcessEnvironment({
        PATH: '/bin',
        HOME: '/home/vera',
        GH_TOKEN: 'github-token',
        OPENAI_API_KEY: 'model-secret',
        MONGODB_URI: 'mongodb://secret',
      }),
      {
        GIT_TERMINAL_PROMPT: '0',
        GH_PROMPT_DISABLED: '1',
        PATH: '/bin',
        HOME: '/home/vera',
        GH_TOKEN: 'github-token',
      },
    );
    assert.deepEqual(
      parseGitHubRepositoryRemote('git@github.com:4romgod/vera.git'),
      {
        owner: '4romgod',
        name: 'vera',
      },
    );
    assert.throws(() =>
      parseGitHubRepositoryRemote('file://github.com/4romgod/vera'),
    );
    assert.throws(() =>
      parseGitHubRepositoryRemote('https://token@github.com/4romgod/vera.git'),
    );
  });

  void it('lists only the approved repository through the connected account', async () => {
    const commands: string[][] = [];
    const run: GitHubCommandRunner = (command, args) => {
      commands.push([command, ...args]);
      if (command === 'git') {
        return Promise.resolve({
          stdout: 'git@github.com:4romgod/vera.git\n',
          stderr: '',
          exitCode: 0,
        });
      }
      if (args[0] === 'api') {
        return Promise.resolve({ stdout: '123\n', stderr: '', exitCode: 0 });
      }
      if (args[0] === 'repo') {
        return Promise.resolve({
          stdout: '4romgod/vera\n',
          stderr: '',
          exitCode: 0,
        });
      }
      return Promise.resolve({
        stdout: JSON.stringify([rawIssue()]),
        stderr: '',
        exitCode: 0,
      });
    };
    const adapter = executor(run);
    assert.deepEqual(
      adapter.authorityFor({
        action: 'list',
        objective: 'List open issues',
        project: { name: 'Vera' },
        state: 'open',
        limit: 20,
      }).sideEffects,
      ['third_party_disclosure'],
    );
    const result = await adapter.execute({
      ...baseInput(),
      arguments: {
        action: 'list',
        objective: 'List open issues',
        project: { name: 'Vera' },
        state: 'open',
        limit: 20,
      },
    });
    assert.equal(result.items[0]?.number, 42);
    assert.ok(
      commands.some((args) =>
        args.join(' ').includes('issue list --repo 4romgod/vera --state open'),
      ),
    );
    assert.equal(JSON.stringify(result).includes('github-token'), false);
  });

  void it('creates one marked issue and reconciles the same invocation without duplicating it', async () => {
    const invocationMarker = '<!-- vera-issue-invocation:invocation_test -->';
    let created = false;
    let createCalls = 0;
    const run: GitHubCommandRunner = (command, args) => {
      if (command === 'git') {
        return Promise.resolve({
          stdout: 'https://github.com/4romgod/vera.git\n',
          stderr: '',
          exitCode: 0,
        });
      }
      if (args[0] === 'api') {
        return Promise.resolve({ stdout: '123\n', stderr: '', exitCode: 0 });
      }
      if (args[0] === 'repo') {
        return Promise.resolve({
          stdout: '4romgod/vera\n',
          stderr: '',
          exitCode: 0,
        });
      }
      if (args[0] === 'issue' && args[1] === 'list') {
        return Promise.resolve({
          stdout: JSON.stringify(
            created ? [rawIssue(`Approved body\n\n${invocationMarker}`)] : [],
          ),
          stderr: '',
          exitCode: 0,
        });
      }
      if (args[0] === 'issue' && args[1] === 'create') {
        createCalls += 1;
        assert.equal(args.includes('--repo'), true);
        assert.equal(args.includes('4romgod/vera'), true);
        assert.equal(args.includes(invocationMarker), false);
        assert.ok(args.some((value) => value.includes(invocationMarker)));
        created = true;
        return Promise.resolve({
          stdout: 'https://github.com/4romgod/vera/issues/42\n',
          stderr: '',
          exitCode: 0,
        });
      }
      if (args[0] === 'issue' && args[1] === 'view') {
        return Promise.resolve({
          stdout: JSON.stringify(
            rawIssue(`Approved body\n\n${invocationMarker}`),
          ),
          stderr: '',
          exitCode: 0,
        });
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    };
    const adapter = executor(run);
    const arguments_ = {
      action: 'create' as const,
      objective: 'Create the issue',
      project: { name: 'Vera' },
      issue: {
        title: 'Track the connection layer',
        body: 'Approved body',
        labels: ['enhancement'],
      },
    };
    const first = await adapter.execute({
      ...baseInput(),
      arguments: arguments_,
    });
    const recovered = await adapter.execute({
      ...baseInput(),
      recovery: true,
      arguments: arguments_,
    });
    assert.equal(first.items[0]?.body, 'Approved body');
    assert.equal(recovered.items[0]?.number, 42);
    assert.equal(createCalls, 1);
  });

  void it('fails closed when recovery cannot prove whether creation happened', async () => {
    const run: GitHubCommandRunner = (command, args) => {
      if (command === 'git') {
        return Promise.resolve({
          stdout: 'git@github.com:4romgod/vera.git',
          stderr: '',
          exitCode: 0,
        });
      }
      if (args[0] === 'api') {
        return Promise.resolve({ stdout: '123', stderr: '', exitCode: 0 });
      }
      if (args[0] === 'repo') {
        return Promise.resolve({
          stdout: '4romgod/vera',
          stderr: '',
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: '[]', stderr: '', exitCode: 0 });
    };
    await assert.rejects(
      executor(run).execute({
        ...baseInput(),
        recovery: true,
        arguments: {
          action: 'create',
          objective: 'Create the issue',
          project: { name: 'Vera' },
          issue: { title: 'Track the connection layer', body: '', labels: [] },
        },
      }),
      { code: 'work_item_outcome_unknown' },
    );
  });
});
