import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

import {
  GitHubSoftwareChangePublicationExecutor,
  githubPublicationProcessEnvironment,
} from '../../../../src/adapters/outbound/change-applications/github-software-change-publication-executor.ts';
import type { SoftwareChangeApplication } from '../../../../src/domain/changes/software-change-application.ts';
import type { SoftwareChangePublication } from '../../../../src/domain/changes/software-change-publication.ts';
import type { Project } from '../../../../src/domain/projects/project.ts';

const executeFile = promisify(execFile);
const cleanups: string[] = [];
const now = '2026-08-27T00:00:00.000Z';

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

afterEach(async () => {
  await Promise.all(
    cleanups
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'vera-publication-'));
  cleanups.push(workspace);
  await executeFile('git', ['init', '--quiet', '--initial-branch=main'], {
    cwd: workspace,
  });
  await executeFile('git', ['config', 'user.name', 'Vera Test'], {
    cwd: workspace,
  });
  await executeFile('git', ['config', 'user.email', 'vera@example.test'], {
    cwd: workspace,
  });
  await writeFile(join(workspace, 'README.md'), '# Before\n');
  await executeFile('git', ['add', 'README.md'], { cwd: workspace });
  await executeFile('git', ['commit', '--quiet', '-m', 'base'], {
    cwd: workspace,
  });
  const baseRevision = trimmed(
    (await executeFile('git', ['rev-parse', 'HEAD'], { cwd: workspace }))
      .stdout,
  );
  await executeFile('git', ['switch', '--quiet', '-c', 'vera/change-test'], {
    cwd: workspace,
  });
  await executeFile(
    'git',
    ['remote', 'add', 'origin', 'git@github.com:owner/fixture.git'],
    { cwd: workspace },
  );
  await writeFile(join(workspace, 'README.md'), '# After\n');
  await executeFile('git', ['add', 'README.md'], { cwd: workspace });

  const application: SoftwareChangeApplication = {
    schemaVersion: 1,
    version: 4,
    id: 'application_test',
    requestKey: 'application-test',
    principalId: 'owner_v1',
    status: 'succeeded',
    sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
    project: { id: 'project_test', displayName: 'Fixture' },
    approval: {
      id: 'approval_application',
      status: 'approved',
      reason: 'software_change_application',
      sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
      project: { id: 'project_test', displayName: 'Fixture' },
      effect: {
        adapterId: 'local_git_worktree',
        baseRevision,
        branchName: 'vera/change-test',
        workspacePath: workspace,
        patchSha256: 'b'.repeat(64),
        staged: true,
        files: [
          {
            relativePath: 'README.md',
            operation: 'update',
            beforeSha256: sha256('# Before\n'),
            afterSha256: sha256('# After\n'),
            bytes: 8,
          },
        ],
      },
      requestedAt: now,
      decidedAt: now,
      decidedBy: 'owner_v1',
    },
    effect: {
      id: 'effect_application',
      status: 'succeeded',
      startedAt: now,
      completedAt: now,
    },
    result: {
      adapterId: 'local_git_worktree',
      baseRevision,
      branchName: 'vera/change-test',
      workspacePath: workspace,
      patchSha256: 'b'.repeat(64),
      staged: true,
      files: [
        {
          relativePath: 'README.md',
          operation: 'update',
          beforeSha256: sha256('# Before\n'),
          afterSha256: sha256('# After\n'),
          bytes: 8,
        },
      ],
      appliedAt: now,
    },
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  const project: Project = {
    schemaVersion: 1,
    id: 'project_test',
    principalId: 'owner_v1',
    registrationKey: 'fixture',
    displayName: 'Fixture',
    normalizedName: 'fixture',
    source: { kind: 'local_git', rootPath: workspace },
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  return { workspace, application, project };
}

function trimmed(value: string | Buffer) {
  return value.toString().trim();
}

void describe('GitHub software-change publication executor', () => {
  void it('passes only publication-required environment variables to Git and GitHub', () => {
    assert.deepEqual(
      githubPublicationProcessEnvironment({
        PATH: '/bin',
        HOME: '/home/vera',
        SSH_AUTH_SOCK: '/tmp/agent.sock',
        GH_TOKEN: 'github-token',
        OPENAI_API_KEY: 'model-secret',
        MONGODB_URI: 'mongodb://secret',
        REDIS_URL: 'redis://secret',
      }),
      {
        GIT_TERMINAL_PROMPT: '0',
        GH_PROMPT_DISABLED: '1',
        PATH: '/bin',
        HOME: '/home/vera',
        SSH_AUTH_SOCK: '/tmp/agent.sock',
        GH_TOKEN: 'github-token',
      },
    );
  });

  void it('refuses to approve a change staged from a stale remote base', async () => {
    const value = await fixture();
    const run = async (
      command: string,
      args: string[],
      options: { cwd?: string } = {},
    ) => {
      if (command === 'git' && args.includes('ls-remote')) {
        const ref = args.at(-1);
        assert.ok(ref);
        return {
          stdout: `${'f'.repeat(40)}\t${ref}\n`,
          stderr: '',
          exitCode: 0,
        };
      }
      if (command === 'gh') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      const result = await executeFile(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    };
    const executor = new GitHubSoftwareChangePublicationExecutor({ run });
    await assert.rejects(
      executor.prepare({
        application: value.application,
        project: value.project,
        baseBranch: 'main',
        commitMessage: 'Publish exact fixture',
        pullRequest: {
          title: 'Publish exact fixture',
          body: 'Verified body\n',
          draft: true,
        },
      }),
      { code: 'review_required' },
    );
  });

  void it('refuses symlink substitution in the staged worktree', async () => {
    const value = await fixture();
    const applicationResult = value.application.result;
    assert.ok(applicationResult);
    await writeFile(join(value.workspace, 'substitute.md'), '# After\n');
    await unlink(join(value.workspace, 'README.md'));
    await symlink('substitute.md', join(value.workspace, 'README.md'));
    await executeFile('git', ['add', 'README.md'], { cwd: value.workspace });
    const run = async (
      command: string,
      args: string[],
      options: { cwd?: string } = {},
    ) => {
      if (command === 'git' && args.includes('ls-remote')) {
        const ref = args.at(-1);
        assert.ok(ref);
        return {
          stdout: `${applicationResult.baseRevision}\t${ref}\n`,
          stderr: '',
          exitCode: 0,
        };
      }
      if (command === 'gh' && args[0] === 'auth') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      const result = await executeFile(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    };
    const executor = new GitHubSoftwareChangePublicationExecutor({ run });
    await assert.rejects(
      executor.prepare({
        application: value.application,
        project: value.project,
        baseBranch: 'main',
        commitMessage: 'Publish exact fixture',
        pullRequest: {
          title: 'Publish exact fixture',
          body: 'Verified body\n',
          draft: true,
        },
      }),
      { code: 'review_required' },
    );
  });

  void it('refuses to approve staged bytes that differ from the durable application result', async () => {
    const value = await fixture();
    const applicationResult = value.application.result;
    assert.ok(applicationResult);
    await writeFile(join(value.workspace, 'README.md'), '# Tampered\n');
    await executeFile('git', ['add', 'README.md'], { cwd: value.workspace });
    const run = async (
      command: string,
      args: string[],
      options: { cwd?: string } = {},
    ) => {
      if (command === 'git' && args.includes('ls-remote')) {
        const ref = args.at(-1);
        assert.ok(ref);
        return {
          stdout: `${applicationResult.baseRevision}\t${ref}\n`,
          stderr: '',
          exitCode: 0,
        };
      }
      if (command === 'gh' && args[0] === 'repo') {
        return { stdout: 'owner/fixture\n', stderr: '', exitCode: 0 };
      }
      if (command === 'gh' && args[0] === 'auth') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      const result = await executeFile(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    };
    const executor = new GitHubSoftwareChangePublicationExecutor({ run });
    await assert.rejects(
      executor.prepare({
        application: value.application,
        project: value.project,
        baseBranch: 'main',
        commitMessage: 'Publish exact fixture',
        pullRequest: {
          title: 'Publish exact fixture',
          body: 'Verified body\n',
          draft: true,
        },
      }),
      { code: 'review_required' },
    );
  });

  void it('creates one exact commit, branch, and PR and reconciles retries', async () => {
    const value = await fixture();
    const applicationResult = value.application.result;
    assert.ok(applicationResult);
    const remoteRevisions = new Map<string, string>([
      ['refs/heads/main', applicationResult.baseRevision],
    ]);
    let pullRequest: Record<string, unknown> | null = null;
    let pushes = 0;
    let creates = 0;
    let moveBaseAfterPullRequestRead = false;
    const run = async (
      command: string,
      args: string[],
      options: { cwd?: string; allowFailure?: boolean } = {},
    ) => {
      if (command === 'git' && args.includes('ls-remote')) {
        const ref = args.at(-1);
        assert.ok(ref);
        const revision = remoteRevisions.get(ref);
        return {
          stdout: revision === undefined ? '' : `${revision}\t${ref}\n`,
          stderr: '',
          exitCode: 0,
        };
      }
      if (command === 'git' && args.includes('push')) {
        pushes += 1;
        assert.equal(args.includes('--force'), false);
        const pushSpec = args.at(-1);
        assert.ok(pushSpec);
        const ref = pushSpec.split(':').at(-1);
        assert.ok(ref);
        remoteRevisions.set(
          ref,
          trimmed(
            (
              await executeFile('git', [
                '-C',
                value.workspace,
                'rev-parse',
                'HEAD',
              ])
            ).stdout,
          ),
        );
        return {
          stdout: '',
          stderr: 'simulated lost acknowledgement',
          exitCode: 1,
        };
      }
      if (command === 'gh' && args[0] === 'repo') {
        return { stdout: 'owner/fixture\n', stderr: '', exitCode: 0 };
      }
      if (command === 'gh' && args[0] === 'auth') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        const response = {
          stdout: JSON.stringify(pullRequest === null ? [] : [pullRequest]),
          stderr: '',
          exitCode: 0,
        };
        if (moveBaseAfterPullRequestRead && pullRequest !== null) {
          remoteRevisions.set('refs/heads/main', 'f'.repeat(40));
          moveBaseAfterPullRequestRead = false;
        }
        return response;
      }
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        creates += 1;
        const bodyPath = args[args.indexOf('--body-file') + 1];
        assert.ok(bodyPath);
        const commit = trimmed(
          (
            await executeFile('git', [
              '-C',
              value.workspace,
              'rev-parse',
              'HEAD',
            ])
          ).stdout,
        );
        pullRequest = {
          number: 17,
          url: 'https://github.com/owner/fixture/pull/17',
          title: args[args.indexOf('--title') + 1],
          body: await readFile(bodyPath, 'utf8'),
          isDraft: args.includes('--draft'),
          state: 'OPEN',
          headRefOid: commit,
          baseRefName: args[args.indexOf('--base') + 1],
        };
        return {
          stdout: 'https://github.com/owner/fixture/pull/17\n',
          stderr: 'simulated lost acknowledgement',
          exitCode: 1,
        };
      }
      const result = await executeFile(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    };
    const executor = new GitHubSoftwareChangePublicationExecutor({
      run,
      clock: () => now,
    });
    const effect = await executor.prepare({
      application: value.application,
      project: value.project,
      baseBranch: 'main',
      commitMessage: 'Publish exact fixture',
      pullRequest: {
        title: 'Publish exact fixture',
        body: 'Verified body\n',
        draft: true,
      },
    });
    const publication: SoftwareChangePublication = {
      schemaVersion: 1,
      version: 3,
      id: 'publication_test',
      requestKey: 'publication-test',
      principalId: 'owner_v1',
      status: 'publishing',
      sourceApplication: {
        id: value.application.id,
        effectId: value.application.effect.id,
        version: value.application.version,
      },
      project: value.application.project,
      approval: {
        id: 'approval_publication',
        status: 'approved',
        reason: 'software_change_publication',
        effect,
        requestedAt: now,
        decidedAt: now,
        decidedBy: 'owner_v1',
      },
      effect: { id: 'effect_publication', status: 'executing', startedAt: now },
      events: [],
      createdAt: now,
      updatedAt: now,
    };

    const first = await executor.execute({
      publication,
      application: value.application,
      project: value.project,
    });
    const recoveredEffect = await executor.prepare({
      application: value.application,
      project: value.project,
      baseBranch: 'main',
      commitMessage: 'Publish exact fixture',
      pullRequest: {
        title: 'Publish exact fixture',
        body: 'Verified body\n',
        draft: true,
      },
    });
    const second = await executor.execute({
      publication,
      application: value.application,
      project: value.project,
    });

    assert.equal(first.commitRevision, second.commitRevision);
    assert.equal(recoveredEffect.treeRevision, effect.treeRevision);
    assert.equal(first.pullRequest.number, 17);
    assert.equal(pushes, 1);
    assert.equal(creates, 1);
    assert.equal(
      trimmed(
        (
          await executeFile('git', ['log', '-1', '--format=%B'], {
            cwd: value.workspace,
          })
        ).stdout,
      ),
      'Publish exact fixture',
    );

    moveBaseAfterPullRequestRead = true;
    await assert.rejects(
      executor.execute({
        publication,
        application: value.application,
        project: value.project,
      }),
      { code: 'review_required' },
    );
  });
});
