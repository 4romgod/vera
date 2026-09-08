import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  workingTreeSnapshotHashPayload,
  WorkingTreeFileSchema,
  WorkingTreeSnapshotSchema,
  type WorkingTreeFile,
  type WorkingTreeSnapshot,
} from '../../../domain/projects/project-context.ts';
import { containsControlCharacter } from '../../../domain/shared/text-safety.ts';

const executeFile = promisify(execFile);
const gitTimeoutMs = 30_000;
const unsafePath =
  /(^|\/)(\.git|\.vera|node_modules|dist|build|coverage)(\/|$)|(^|\/)(\.env($|\.)|\.npmrc$|\.pypirc$|\.netrc$|\.yarnrc\.yml$|.*(?:credential|credentials|secret|secrets|private[-_.]?key|id_rsa|id_ed25519|\.pem$|\.p12$|\.pfx$))|(^|\/)(agents\.md|claude\.md|gemini\.md|skill\.md|\.cursorrules|\.clinerules|\.windsurfrules|copilot-instructions\.md|.*\.prompt\.md)$|(^|\/)\.github\/(instructions|prompts)(\/|$)|(^|\/)\.(cursor|windsurf)\/rules(\/|$)/iu;

type StatusEntry = {
  relativePath: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export class WorkingTreeInspectionError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | 'unsafe_path'
      | 'unsupported_file'
      | 'snapshot_too_large'
      | 'snapshot_changed',
  ) {
    super(message);
    this.name = 'WorkingTreeInspectionError';
  }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSafePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes('\\') ||
    isAbsolute(path) ||
    containsControlCharacter(path) ||
    path
      .split('/')
      .some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      ) ||
    unsafePath.test(path)
  ) {
    throw new WorkingTreeInspectionError(
      `The working tree contains a change at an unsafe path: ${path}.`,
      'unsafe_path',
    );
  }
}

function parseStatus(output: string): StatusEntry[] {
  const entries = output.split('\u0000').filter(Boolean);
  return entries.map((entry) => {
    if (entry.length < 4 || entry[2] !== ' ') {
      throw new WorkingTreeInspectionError(
        'The working tree contains an unsupported Git status entry.',
        'unsupported_file',
      );
    }
    const index = entry[0];
    const worktree = entry[1];
    const relativePath = entry.slice(3);
    if (index === undefined || worktree === undefined) {
      throw new WorkingTreeInspectionError(
        'The working tree contains an incomplete Git status entry.',
        'unsupported_file',
      );
    }
    assertSafePath(relativePath);
    const untracked = index === '?' && worktree === '?';
    if (
      !untracked &&
      (![' ', 'A', 'M', 'D'].includes(index) ||
        ![' ', 'A', 'M', 'D'].includes(worktree))
    ) {
      throw new WorkingTreeInspectionError(
        `The working tree contains an unsupported change at ${relativePath}.`,
        'unsupported_file',
      );
    }
    return {
      relativePath,
      staged: !untracked && index !== ' ',
      unstaged: untracked || worktree !== ' ',
      untracked,
    };
  });
}

async function git(
  rootPath: string,
  arguments_: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await executeFile('git', ['-C', rootPath, ...arguments_], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: gitTimeoutMs,
    ...(environment === undefined ? {} : { env: environment }),
  });
  return result.stdout;
}

async function gitBuffer(
  rootPath: string,
  arguments_: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<Buffer | null> {
  try {
    return await new Promise((resolvePromise, reject) => {
      execFile(
        'git',
        ['-C', rootPath, ...arguments_],
        {
          encoding: 'buffer',
          maxBuffer: 10 * 1024 * 1024,
          timeout: gitTimeoutMs,
          ...(environment === undefined ? {} : { env: environment }),
        },
        (error, stdout) => {
          if (error !== null) {
            reject(
              error instanceof Error
                ? error
                : new Error('Git file inspection failed.'),
            );
          } else resolvePromise(stdout);
        },
      );
    });
  } catch (error) {
    if ((error as { code?: number }).code === 128) return null;
    throw error;
  }
}

async function gitEntryMode(
  rootPath: string,
  arguments_: string[],
  relativePath: string,
  environment?: NodeJS.ProcessEnv,
): Promise<string | null> {
  const output = await git(
    rootPath,
    [...arguments_, '--', relativePath],
    environment,
  );
  if (output.length === 0) return null;
  const entries = output.split('\u0000').filter(Boolean);
  const mode = entries[0]?.split(' ', 1)[0];
  if (entries.length !== 1 || mode === undefined || !/^\d{6}$/u.test(mode)) {
    throw new WorkingTreeInspectionError(
      `Git returned invalid file metadata for ${relativePath}.`,
      'unsupported_file',
    );
  }
  return mode;
}

async function currentFile(
  rootPath: string,
  relativePath: string,
): Promise<Buffer | null> {
  const absolutePath = resolve(rootPath, relativePath);
  if (!absolutePath.startsWith(`${rootPath}${sep}`)) {
    throw new WorkingTreeInspectionError(
      `The working tree path escapes the project root: ${relativePath}.`,
      'unsafe_path',
    );
  }
  try {
    const information = await lstat(absolutePath);
    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      (information.mode & 0o111) !== 0
    ) {
      throw new WorkingTreeInspectionError(
        `The working tree change at ${relativePath} is not a supported regular file.`,
        'unsupported_file',
      );
    }
    const canonical = await realpath(absolutePath);
    if (!canonical.startsWith(`${rootPath}${sep}`)) {
      throw new WorkingTreeInspectionError(
        `The working tree path escapes the project root: ${relativePath}.`,
        'unsafe_path',
      );
    }
    return await readFile(canonical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertText(path: string, content: Buffer): void {
  if (content.includes(0)) {
    throw new WorkingTreeInspectionError(
      `The working tree contains an unsupported binary change at ${path}.`,
      'unsupported_file',
    );
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new WorkingTreeInspectionError(
      `The working tree contains invalid UTF-8 at ${path}.`,
      'unsupported_file',
    );
  }
}

async function describeFile(
  rootPath: string,
  baseRevision: string,
  status: StatusEntry,
  maxFileBytes: number,
  indexEnvironment?: NodeJS.ProcessEnv,
): Promise<WorkingTreeFile> {
  const [before, after, beforeMode, indexedAfterMode] = await Promise.all([
    gitBuffer(rootPath, ['show', `${baseRevision}:${status.relativePath}`]),
    indexEnvironment === undefined
      ? currentFile(rootPath, status.relativePath)
      : gitBuffer(
          rootPath,
          ['show', `:${status.relativePath}`],
          indexEnvironment,
        ),
    gitEntryMode(
      rootPath,
      ['ls-tree', '-z', baseRevision],
      status.relativePath,
    ),
    indexEnvironment === undefined
      ? Promise.resolve(null)
      : gitEntryMode(
          rootPath,
          ['ls-files', '--stage', '-z'],
          status.relativePath,
          indexEnvironment,
        ),
  ]);
  const afterMode =
    indexEnvironment === undefined
      ? after === null
        ? null
        : '100644'
      : indexedAfterMode;
  if (
    (before === null) !== (beforeMode === null) ||
    (after === null) !== (afterMode === null)
  ) {
    throw new WorkingTreeInspectionError(
      `Git returned inconsistent file state for ${status.relativePath}.`,
      'unsupported_file',
    );
  }
  if (
    (beforeMode !== null && beforeMode !== '100644') ||
    (afterMode !== null && afterMode !== '100644')
  ) {
    throw new WorkingTreeInspectionError(
      `The working tree change at ${status.relativePath} is not a supported non-executable regular file.`,
      'unsupported_file',
    );
  }
  if (before !== null) assertText(status.relativePath, before);
  if (after !== null) assertText(status.relativePath, after);
  if (
    (before?.byteLength ?? 0) > maxFileBytes ||
    (after?.byteLength ?? 0) > maxFileBytes
  ) {
    throw new WorkingTreeInspectionError(
      `The working tree change at ${status.relativePath} exceeds the per-file limit.`,
      'snapshot_too_large',
    );
  }
  const identity = {
    relativePath: status.relativePath,
    staged: status.staged,
    unstaged: status.unstaged,
    untracked: status.untracked,
  };
  if (before === null && after !== null) {
    return {
      ...identity,
      operation: 'create',
      afterSha256: sha256(after),
      bytes: after.byteLength,
    };
  }
  if (before !== null && after === null) {
    return {
      ...identity,
      operation: 'delete',
      beforeSha256: sha256(before),
      bytes: 0,
    };
  }
  if (before !== null && after !== null) {
    return {
      ...identity,
      operation: 'update',
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      bytes: after.byteLength,
    };
  }
  throw new WorkingTreeInspectionError(
    `The working tree change at ${status.relativePath} has no material file state.`,
    'unsupported_file',
  );
}

export async function inspectLocalGitWorkingTree(input: {
  rootPath: string;
  maxFiles?: number;
  maxBytes?: number;
  maxFileBytes?: number;
  maxPatchBytes?: number;
  clock?: () => string;
}): Promise<WorkingTreeSnapshot | null> {
  const rootPath = await realpath(input.rootPath);
  const firstStatus = await git(rootPath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  if (firstStatus.length === 0) return null;
  const statuses = parseStatus(firstStatus).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  if (
    new Set(statuses.map((status) => status.relativePath)).size !==
    statuses.length
  ) {
    throw new WorkingTreeInspectionError(
      'The working tree contains conflicting states for one path.',
      'unsupported_file',
    );
  }
  const maxFiles = input.maxFiles ?? 100;
  if (statuses.length > maxFiles) {
    throw new WorkingTreeInspectionError(
      `The working tree contains ${String(statuses.length)} changed files, exceeding the ${String(maxFiles)}-file limit.`,
      'snapshot_too_large',
    );
  }
  const baseRevision = (
    await git(rootPath, ['rev-parse', 'HEAD^{commit}'])
  ).trim();
  const temporary = await mkdtemp(join(tmpdir(), 'vera-working-tree-'));
  try {
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      GIT_INDEX_FILE: join(temporary, 'index'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    };
    await git(rootPath, ['read-tree', baseRevision], environment);
    await git(
      rootPath,
      ['add', '-A', '--', ...statuses.map((status) => status.relativePath)],
      environment,
    );
    const files = (
      await Promise.all(
        statuses.map(async (status) =>
          describeFile(
            rootPath,
            baseRevision,
            status,
            input.maxFileBytes ?? 1_000_000,
            environment,
          ),
        ),
      )
    ).map((file) => WorkingTreeFileSchema.parse(file));
    const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
    if (totalBytes > (input.maxBytes ?? 1_000_000)) {
      throw new WorkingTreeInspectionError(
        `The working tree contains ${String(totalBytes)} changed bytes, exceeding the snapshot limit.`,
        'snapshot_too_large',
      );
    }
    const patch = await git(
      rootPath,
      [
        'diff',
        '--cached',
        '--binary',
        '--no-ext-diff',
        '--no-renames',
        baseRevision,
        '--',
      ],
      environment,
    );
    if (!patch.startsWith('diff --git ')) {
      throw new WorkingTreeInspectionError(
        'The working tree changed while Vera was capturing it.',
        'snapshot_changed',
      );
    }
    const secondStatus = await git(rootPath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]);
    if (secondStatus !== firstStatus) {
      throw new WorkingTreeInspectionError(
        'The working tree changed while Vera was capturing it.',
        'snapshot_changed',
      );
    }
    const currentFiles = (
      await Promise.all(
        statuses.map(async (status) =>
          describeFile(
            rootPath,
            baseRevision,
            status,
            input.maxFileBytes ?? 1_000_000,
          ),
        ),
      )
    ).map((file) => WorkingTreeFileSchema.parse(file));
    const thirdStatus = await git(rootPath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]);
    const currentBaseRevision = (
      await git(rootPath, ['rev-parse', 'HEAD^{commit}'])
    ).trim();
    if (
      thirdStatus !== firstStatus ||
      currentBaseRevision !== baseRevision ||
      JSON.stringify(currentFiles) !== JSON.stringify(files)
    ) {
      throw new WorkingTreeInspectionError(
        'The working tree changed while Vera was capturing it.',
        'snapshot_changed',
      );
    }
    if (
      Buffer.byteLength(patch) >
      (input.maxPatchBytes ?? input.maxBytes ?? 1_000_000)
    ) {
      throw new WorkingTreeInspectionError(
        'The working-tree patch exceeds the snapshot byte limit.',
        'snapshot_too_large',
      );
    }
    const patchSha256 = sha256(patch);
    const snapshotSha256 = sha256(
      JSON.stringify(
        workingTreeSnapshotHashPayload({ baseRevision, patchSha256, files }),
      ),
    );
    return WorkingTreeSnapshotSchema.parse({
      schemaVersion: 1,
      baseRevision,
      snapshotSha256,
      patchSha256,
      patch,
      files,
      totalFiles: files.length,
      totalBytes,
      capturedAt: (input.clock ?? (() => new Date().toISOString()))(),
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
