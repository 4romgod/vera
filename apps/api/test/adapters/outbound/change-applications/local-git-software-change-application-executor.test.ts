import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

import { LocalGitSoftwareChangeApplicationExecutor } from '../../../../src/adapters/outbound/change-applications/local-git-software-change-application-executor.ts';
import type { Artifact } from '../../../../src/domain/artifacts/artifact.ts';
import type { Project } from '../../../../src/domain/projects/project.ts';
import type { SoftwareChangeApplication } from '../../../../src/domain/changes/software-change-application.ts';
import { ChangeApplicationExecutionError } from '../../../../src/ports/change-applications/software-change-application-executor.ts';

const executeFile = promisify(execFile);
const cleanups: string[] = [];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vera-apply-project-'));
  const workspacesRoot = await mkdtemp(
    join(tmpdir(), 'vera-apply-workspaces-'),
  );
  cleanups.push(projectRoot, workspacesRoot);
  await executeFile('git', ['init', '--quiet'], { cwd: projectRoot });
  const before = '# Fixture\n';
  const after = '# Fixture\n\nApplied by Vera.\n';
  await writeFile(join(projectRoot, 'README.md'), before, 'utf8');
  await executeFile('git', ['add', 'README.md'], { cwd: projectRoot });
  await executeFile(
    'git',
    [
      '-c',
      'user.name=Vera Test',
      '-c',
      'user.email=vera@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: projectRoot },
  );
  const revision = (
    await executeFile('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
  ).stdout.trim();
  const patch = [
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1,3 @@',
    ' # Fixture',
    '+',
    '+Applied by Vera.',
    '',
  ].join('\n');
  const content = {
    schemaVersion: 1 as const,
    project: { id: 'project_test', name: 'Fixture', revision },
    ticket: { reference: 'untracked', details: 'Update the fixture.' },
    objective: 'Update the fixture.',
    summary: 'Updated the fixture.',
    files: [
      {
        relativePath: 'README.md',
        operation: 'update' as const,
        beforeSha256: hash(before),
        afterSha256: hash(after),
        bytes: Buffer.byteLength(after),
      },
    ],
    patch,
    verification: [],
    risks: [],
  };
  const artifact: Extract<Artifact, { type: 'software_change' }> = {
    schemaVersion: 1,
    id: 'artifact_test',
    version: 1,
    principalId: 'owner_v1',
    taskId: 'task_test',
    runId: 'run_test',
    invocationId: 'invocation_test',
    projectId: 'project_test',
    type: 'software_change',
    mediaType: 'application/vnd.vera.software-change+json',
    sha256: hash(JSON.stringify(content)),
    byteLength: Buffer.byteLength(JSON.stringify(content)),
    producer: { provider: 'test', model: 'test', durationMs: 1 },
    content,
    createdAt: '2026-08-25T00:00:00.000Z',
  };
  const project: Project = {
    schemaVersion: 1,
    id: 'project_test',
    principalId: 'owner_v1',
    registrationKey: 'project-test',
    displayName: 'Fixture',
    normalizedName: 'fixture',
    source: { kind: 'local_git', rootPath: projectRoot },
    status: 'active',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  };
  const executor = new LocalGitSoftwareChangeApplicationExecutor({
    workspacesRoot,
    clock: () => '2026-08-25T00:00:10.000Z',
  });
  return {
    projectRoot,
    workspacesRoot,
    before,
    after,
    artifact,
    project,
    executor,
  };
}

function application(
  prepared: Awaited<
    ReturnType<LocalGitSoftwareChangeApplicationExecutor['prepare']>
  >,
): SoftwareChangeApplication {
  return {
    schemaVersion: 1,
    version: 3,
    id: 'application_1234567890abcdef',
    requestKey: 'application-test',
    principalId: 'owner_v1',
    status: 'applying',
    sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
    project: { id: 'project_test', displayName: 'Fixture' },
    approval: {
      id: 'approval_test',
      status: 'approved',
      reason: 'software_change_application',
      sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
      project: { id: 'project_test', displayName: 'Fixture' },
      effect: prepared,
      requestedAt: '2026-08-25T00:00:00.000Z',
      decidedAt: '2026-08-25T00:00:01.000Z',
      decidedBy: 'owner_v1',
    },
    effect: {
      id: 'effect_test',
      status: 'executing',
      startedAt: '2026-08-25T00:00:02.000Z',
    },
    events: [],
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:02.000Z',
  };
}

afterEach(async () => {
  await Promise.all(
    cleanups
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

void describe('local Git software-change application executor', () => {
  void it('materializes, stages, and reconciles an exact patch without changing the registered checkout', async () => {
    const value = await fixture();
    const prepared = await value.executor.prepare({
      applicationId: 'application_1234567890abcdef',
      artifact: value.artifact,
      project: value.project,
    });
    const first = await value.executor.execute({
      application: application(prepared),
      artifact: value.artifact,
      project: value.project,
    });
    const second = await value.executor.execute({
      application: application(prepared),
      artifact: value.artifact,
      project: value.project,
    });

    assert.equal(
      await readFile(join(value.projectRoot, 'README.md'), 'utf8'),
      value.before,
    );
    assert.equal(
      await readFile(join(first.workspacePath, 'README.md'), 'utf8'),
      value.after,
    );
    assert.equal(first.workspacePath, second.workspacePath);
    assert.equal(first.branchName, 'vera/change-1234567890ab');
    assert.equal(
      (
        await executeFile('git', ['diff', '--cached', '--name-only'], {
          cwd: first.workspacePath,
        })
      ).stdout.trim(),
      'README.md',
    );
    assert.equal(
      (
        await executeFile('git', ['status', '--porcelain'], {
          cwd: value.projectRoot,
        })
      ).stdout,
      '',
    );
  });

  void it('refuses mutable or stale project state before requesting approval', async () => {
    const value = await fixture();
    value.artifact.content.project.revision += '+working-tree';
    await assert.rejects(
      value.executor.prepare({
        applicationId: 'application_1234567890abcdef',
        artifact: value.artifact,
        project: value.project,
      }),
      (error: unknown) =>
        error instanceof ChangeApplicationExecutionError &&
        error.code === 'stale_source',
    );
  });

  void it('removes a newly created managed worktree when the patch conflicts', async () => {
    const value = await fixture();
    value.artifact.content.patch = value.artifact.content.patch.replace(
      ' # Fixture',
      ' # Missing context',
    );
    const prepared = await value.executor.prepare({
      applicationId: 'application_1234567890abcdef',
      artifact: value.artifact,
      project: value.project,
    });
    await assert.rejects(
      value.executor.execute({
        application: application(prepared),
        artifact: value.artifact,
        project: value.project,
      }),
      (error: unknown) =>
        error instanceof ChangeApplicationExecutionError &&
        error.code === 'application_conflict',
    );
    assert.equal(await pathExists(prepared.workspacePath), false);
    const branch = await executeFile(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${prepared.branchName}`],
      { cwd: value.projectRoot },
    ).catch((error: unknown) => error as { code: number });
    assert.equal('code' in branch ? branch.code : 0, 1);
  });

  void it('cancels by removing a managed worktree whose effect has not started', async () => {
    const value = await fixture();
    const prepared = await value.executor.prepare({
      applicationId: 'application_1234567890abcdef',
      artifact: value.artifact,
      project: value.project,
    });
    await executeFile(
      'git',
      [
        'worktree',
        'add',
        '-b',
        prepared.branchName,
        '--',
        prepared.workspacePath,
        prepared.baseRevision,
      ],
      { cwd: value.projectRoot },
    );

    const reconciliation = await value.executor.reconcileCancellation({
      application: application(prepared),
      artifact: value.artifact,
      project: value.project,
    });

    assert.deepEqual(reconciliation, { outcome: 'cancelled' });
    assert.equal(await pathExists(prepared.workspacePath), false);
    const branch = await executeFile(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${prepared.branchName}`],
      { cwd: value.projectRoot },
    ).catch((error: unknown) => error as { code: number });
    assert.equal('code' in branch ? branch.code : 0, 1);
  });

  void it('reports success when cancellation races with an already staged exact effect', async () => {
    const value = await fixture();
    const prepared = await value.executor.prepare({
      applicationId: 'application_1234567890abcdef',
      artifact: value.artifact,
      project: value.project,
    });
    await value.executor.execute({
      application: application(prepared),
      artifact: value.artifact,
      project: value.project,
    });

    const reconciliation = await value.executor.reconcileCancellation({
      application: application(prepared),
      artifact: value.artifact,
      project: value.project,
    });

    assert.equal(reconciliation.outcome, 'succeeded');
    assert.equal(reconciliation.result.workspacePath, prepared.workspacePath);
    assert.equal(reconciliation.result.staged, true);
    assert.equal(
      await readFile(join(prepared.workspacePath, 'README.md'), 'utf8'),
      value.after,
    );
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
