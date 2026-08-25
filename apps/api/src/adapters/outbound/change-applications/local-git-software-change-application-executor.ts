import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  realpath,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';

import type { Artifact } from '../../../domain/artifacts/artifact.ts';
import type {
  ChangeApplicationFile,
  SoftwareChangeApplication,
} from '../../../domain/changes/software-change-application.ts';
import type { Project } from '../../../domain/projects/project.ts';
import {
  ChangeApplicationExecutionError,
  type ChangeApplicationExecutionResult,
  type PreparedChangeApplication,
  type SoftwareChangeApplicationExecutor,
} from '../../../ports/change-applications/software-change-application-executor.ts';

const executeFile = promisify(execFile);
const gitTimeoutMs = 30_000;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isWithin(parent: string, child: string): boolean {
  const candidate = relative(parent, child);
  return (
    candidate === '' ||
    (!candidate.startsWith(`..${sep}`) &&
      candidate !== '..' &&
      !isAbsolute(candidate))
  );
}

function assertSafeRelativePath(value: string): void {
  if (
    value.includes('\u0000') ||
    isAbsolute(value) ||
    value.split(/[\\/]/u).some((segment) => segment === '..' || segment === '')
  ) {
    throw new ChangeApplicationExecutionError(
      `The change contains an unsafe path: ${value}.`,
      'application_conflict',
    );
  }
}

async function runGit(
  rootPath: string,
  args: string[],
  options: { signal?: AbortSignal; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await executeFile('git', ['-C', rootPath, ...args], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: gitTimeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (options.allowFailure === true && typeof failure.code === 'number') {
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        exitCode: failure.code,
      };
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function fileSnapshot(
  path: string,
): Promise<{ sha256: string; bytes: number } | null> {
  try {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) return null;
    return { sha256: sha256(await readFile(path)), bytes: information.size };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

type FileState = 'before' | 'after' | 'neither';

async function classifyFile(
  workspacePath: string,
  file: ChangeApplicationFile,
): Promise<FileState> {
  const snapshot = await fileSnapshot(
    resolve(workspacePath, file.relativePath),
  );
  switch (file.operation) {
    case 'create':
      return snapshot === null
        ? 'before'
        : snapshot.sha256 === file.afterSha256 && snapshot.bytes === file.bytes
          ? 'after'
          : 'neither';
    case 'update':
      return snapshot?.sha256 === file.beforeSha256
        ? 'before'
        : snapshot?.sha256 === file.afterSha256 && snapshot.bytes === file.bytes
          ? 'after'
          : 'neither';
    case 'delete':
      return snapshot?.sha256 === file.beforeSha256
        ? 'before'
        : snapshot === null
          ? 'after'
          : 'neither';
  }
}

async function classifyWorkspace(
  workspacePath: string,
  files: ChangeApplicationFile[],
): Promise<'before' | 'after' | 'mixed'> {
  const states = await Promise.all(
    files.map(async (file) => classifyFile(workspacePath, file)),
  );
  if (states.every((state) => state === 'before')) return 'before';
  if (states.every((state) => state === 'after')) return 'after';
  return 'mixed';
}

function parseStagedPaths(output: string): { status: string; path: string }[] {
  const fields = output.split('\u0000');
  const entries: { status: string; path: string }[] = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status === undefined || path === undefined || status.length === 0) {
      continue;
    }
    entries.push({ status, path });
  }
  return entries;
}

function expectedStatus(file: ChangeApplicationFile): string {
  switch (file.operation) {
    case 'create':
      return 'A';
    case 'update':
      return 'M';
    case 'delete':
      return 'D';
  }
}

async function assertStagedEffect(
  workspacePath: string,
  files: ChangeApplicationFile[],
): Promise<void> {
  const output = (
    await runGit(workspacePath, [
      'diff',
      '--cached',
      '--name-status',
      '-z',
      '--no-renames',
      '--',
    ])
  ).stdout;
  const actual = parseStagedPaths(output).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const expected = files
    .map((file) => ({ status: expectedStatus(file), path: file.relativePath }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ChangeApplicationExecutionError(
      'The materialized Git effect differs from the approved file manifest.',
      'review_required',
    );
  }
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The change application was aborted.', 'AbortError');
  }
}

export class LocalGitSoftwareChangeApplicationExecutor
  implements SoftwareChangeApplicationExecutor
{
  public readonly adapterId = 'local_git_worktree' as const;
  private readonly workspacesRoot: string;

  public constructor(options: {
    workspacesRoot: string;
    clock?: () => string;
  }) {
    this.workspacesRoot = resolve(options.workspacesRoot);
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private readonly clock: () => string;

  public async checkReadiness(): Promise<void> {
    await mkdir(this.workspacesRoot, { recursive: true });
    await access(this.workspacesRoot, constants.R_OK | constants.W_OK);
    await executeFile('git', ['--version'], { timeout: gitTimeoutMs });
  }

  public async prepare(input: {
    applicationId: string;
    artifact: Extract<Artifact, { type: 'software_change' }>;
    project: Project;
  }): Promise<PreparedChangeApplication> {
    await this.checkReadiness();
    const revision = input.artifact.content.project.revision;
    if (!/^[a-f0-9]{40,64}$/u.test(revision)) {
      throw new ChangeApplicationExecutionError(
        'Only a software change produced from an immutable Git commit can be applied. Generate a new artifact from a clean working tree.',
        'stale_source',
      );
    }
    if (
      input.artifact.projectId !== input.project.id ||
      input.artifact.content.project.id !== input.project.id
    ) {
      throw new ChangeApplicationExecutionError(
        'The software-change artifact does not belong to the selected project.',
        'application_conflict',
      );
    }
    const files = structuredClone(input.artifact.content.files);
    const paths = new Set<string>();
    for (const file of files) {
      assertSafeRelativePath(file.relativePath);
      if (paths.has(file.relativePath)) {
        throw new ChangeApplicationExecutionError(
          `The change contains duplicate file path ${file.relativePath}.`,
          'application_conflict',
        );
      }
      paths.add(file.relativePath);
    }
    const projectRoot = await realpath(input.project.source.rootPath);
    const workspacesRoot = await realpath(this.workspacesRoot);
    if (
      isWithin(projectRoot, workspacesRoot) ||
      isWithin(workspacesRoot, projectRoot)
    ) {
      throw new ChangeApplicationExecutionError(
        'The managed change-application root must be separate from the registered project.',
        'application_conflict',
      );
    }
    await this.assertCurrentSource(projectRoot, revision);
    const suffix = input.applicationId.slice(
      'application_'.length,
      'application_'.length + 12,
    );
    return {
      adapterId: this.adapterId,
      baseRevision: revision,
      branchName: `vera/change-${suffix}`,
      workspacePath: resolve(workspacesRoot, input.applicationId),
      patchSha256: sha256(input.artifact.content.patch),
      staged: true,
      files,
    };
  }

  public async execute(input: {
    application: SoftwareChangeApplication;
    artifact: Extract<Artifact, { type: 'software_change' }>;
    project: Project;
    signal?: AbortSignal;
  }): Promise<ChangeApplicationExecutionResult> {
    abortIfRequested(input.signal);
    const approved = input.application.approval.effect;
    const prepared = await this.prepare({
      applicationId: input.application.id,
      artifact: input.artifact,
      project: input.project,
    });
    if (!isDeepStrictEqual(prepared, approved)) {
      throw new ChangeApplicationExecutionError(
        'The current application effect no longer matches the approved effect.',
        'stale_source',
      );
    }
    const projectRoot = await realpath(input.project.source.rootPath);
    let materialized = false;
    try {
      materialized = await this.materializeWorktree(
        projectRoot,
        prepared,
        input.signal,
      );
      const initialState = await classifyWorkspace(
        prepared.workspacePath,
        prepared.files,
      );
      if (initialState === 'mixed') {
        throw new ChangeApplicationExecutionError(
          'The managed worktree contains a partial or unexpected effect and requires review.',
          'review_required',
        );
      }
      if (initialState === 'before') {
        abortIfRequested(input.signal);
        const patchPath = resolve(
          this.workspacesRoot,
          `.${input.application.id}.patch`,
        );
        await writeFile(patchPath, input.artifact.content.patch, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'w',
        });
        try {
          const checked = await runGit(
            prepared.workspacePath,
            ['apply', '--check', '--index', '--', patchPath],
            {
              allowFailure: true,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
          );
          if (checked.exitCode !== 0) {
            throw new ChangeApplicationExecutionError(
              'The approved patch no longer applies cleanly to its exact base revision.',
              'application_conflict',
            );
          }
          abortIfRequested(input.signal);
          await runGit(
            prepared.workspacePath,
            ['apply', '--index', '--', patchPath],
            input.signal === undefined ? {} : { signal: input.signal },
          );
        } finally {
          await unlink(patchPath).catch(() => undefined);
        }
      }
      const finalState = await classifyWorkspace(
        prepared.workspacePath,
        prepared.files,
      );
      if (finalState !== 'after') {
        throw new ChangeApplicationExecutionError(
          'The applied files do not match the approved after-state hashes.',
          'review_required',
        );
      }
      await assertStagedEffect(prepared.workspacePath, prepared.files);
      return { ...prepared, appliedAt: this.clock() };
    } catch (error) {
      const managedWorkspaceExists =
        materialized || (await pathExists(prepared.workspacePath));
      if (
        managedWorkspaceExists &&
        (error instanceof ChangeApplicationExecutionError
          ? error.code !== 'review_required'
          : error instanceof Error && error.name === 'AbortError')
      ) {
        const state = await classifyWorkspace(
          prepared.workspacePath,
          prepared.files,
        ).catch(() => 'mixed' as const);
        if (state === 'before') {
          await this.removeManagedWorktree(projectRoot, prepared).catch(
            (cleanupError: unknown) => {
              throw new ChangeApplicationExecutionError(
                `Vera could not reconcile the managed worktree after a failed application: ${cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup failure'}`,
                'review_required',
              );
            },
          );
        } else if (state === 'after') {
          await assertStagedEffect(prepared.workspacePath, prepared.files);
          return { ...prepared, appliedAt: this.clock() };
        } else {
          throw new ChangeApplicationExecutionError(
            'The failed application left a partial managed worktree effect that requires review.',
            'review_required',
          );
        }
      }
      throw error;
    }
  }

  public async reconcileCancellation(input: {
    application: SoftwareChangeApplication;
    artifact: Extract<Artifact, { type: 'software_change' }>;
    project: Project;
  }): Promise<
    | { outcome: 'cancelled' }
    | { outcome: 'succeeded'; result: ChangeApplicationExecutionResult }
  > {
    const prepared = await this.prepare({
      applicationId: input.application.id,
      artifact: input.artifact,
      project: input.project,
    });
    if (!isDeepStrictEqual(prepared, input.application.approval.effect)) {
      throw new ChangeApplicationExecutionError(
        'The current application effect no longer matches the approved effect.',
        'stale_source',
      );
    }
    const projectRoot = await realpath(input.project.source.rootPath);
    if (!(await pathExists(prepared.workspacePath))) {
      await this.removeManagedWorktree(projectRoot, prepared);
      return { outcome: 'cancelled' };
    }
    const materialized = await this.materializeWorktree(projectRoot, prepared);
    if (!materialized) {
      throw new ChangeApplicationExecutionError(
        'Vera could not inspect the managed worktree during cancellation.',
        'review_required',
      );
    }
    const state = await classifyWorkspace(
      prepared.workspacePath,
      prepared.files,
    );
    if (state === 'before') {
      await this.removeManagedWorktree(projectRoot, prepared);
      return { outcome: 'cancelled' };
    }
    if (state === 'after') {
      await assertStagedEffect(prepared.workspacePath, prepared.files);
      return {
        outcome: 'succeeded',
        result: { ...prepared, appliedAt: this.clock() },
      };
    }
    throw new ChangeApplicationExecutionError(
      'Cancellation found a partial or unexpected managed worktree effect that requires review.',
      'review_required',
    );
  }

  private async assertCurrentSource(
    projectRoot: string,
    revision: string,
  ): Promise<void> {
    const root = await realpath(
      (
        await runGit(projectRoot, ['rev-parse', '--show-toplevel'])
      ).stdout.trim(),
    );
    if (root !== projectRoot) {
      throw new ChangeApplicationExecutionError(
        'The registered project root is no longer the Git repository root.',
        'stale_source',
      );
    }
    const head = (
      await runGit(projectRoot, ['rev-parse', 'HEAD'])
    ).stdout.trim();
    const status = (
      await runGit(projectRoot, [
        'status',
        '--porcelain',
        '--untracked-files=no',
      ])
    ).stdout;
    if (head !== revision || status.length > 0) {
      throw new ChangeApplicationExecutionError(
        'The registered project no longer matches the clean commit used to produce the artifact.',
        'stale_source',
      );
    }
  }

  private async materializeWorktree(
    projectRoot: string,
    prepared: PreparedChangeApplication,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (await pathExists(prepared.workspacePath)) {
      const actualRoot = await realpath(
        (
          await runGit(prepared.workspacePath, ['rev-parse', '--show-toplevel'])
        ).stdout.trim(),
      );
      const branch = (
        await runGit(prepared.workspacePath, [
          'symbolic-ref',
          '--short',
          'HEAD',
        ])
      ).stdout.trim();
      if (
        actualRoot !== prepared.workspacePath ||
        branch !== prepared.branchName
      ) {
        throw new ChangeApplicationExecutionError(
          'The managed workspace path is occupied by an unexpected repository.',
          'review_required',
        );
      }
      return true;
    }
    const branchResult = await runGit(
      projectRoot,
      ['show-ref', '--verify', '--quiet', `refs/heads/${prepared.branchName}`],
      { allowFailure: true },
    );
    if (branchResult.exitCode === 0) {
      const branchRevision = (
        await runGit(projectRoot, ['rev-parse', prepared.branchName])
      ).stdout.trim();
      if (branchRevision !== prepared.baseRevision) {
        throw new ChangeApplicationExecutionError(
          'The deterministic application branch already exists at another revision.',
          'review_required',
        );
      }
      await runGit(
        projectRoot,
        ['worktree', 'add', '--', prepared.workspacePath, prepared.branchName],
        signal === undefined ? {} : { signal },
      );
      return true;
    }
    if (branchResult.exitCode !== 1) {
      throw new ChangeApplicationExecutionError(
        'Vera could not inspect the deterministic application branch.',
        'application_failed',
      );
    }
    await runGit(
      projectRoot,
      [
        'worktree',
        'add',
        '-b',
        prepared.branchName,
        '--',
        prepared.workspacePath,
        prepared.baseRevision,
      ],
      signal === undefined ? {} : { signal },
    );
    return true;
  }

  private async removeManagedWorktree(
    projectRoot: string,
    prepared: PreparedChangeApplication,
  ): Promise<void> {
    if (await pathExists(prepared.workspacePath)) {
      await runGit(projectRoot, [
        'worktree',
        'remove',
        '--force',
        '--',
        prepared.workspacePath,
      ]);
    }
    const branch = await runGit(
      projectRoot,
      ['show-ref', '--verify', '--quiet', `refs/heads/${prepared.branchName}`],
      { allowFailure: true },
    );
    if (branch.exitCode === 0) {
      await runGit(projectRoot, ['branch', '-D', '--', prepared.branchName]);
    }
  }
}
