import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

import type {
  ChangeApplicationFile,
  SoftwareChangeApplication,
} from '../../../domain/changes/software-change-application.ts';
import type {
  PublicationEffect,
  SoftwareChangePublication,
} from '../../../domain/changes/software-change-publication.ts';
import type { Project } from '../../../domain/projects/project.ts';
import {
  SoftwareChangePublicationExecutionError,
  type SoftwareChangePublicationExecutor,
  type SoftwareChangePublicationResult,
} from '../../../ports/change-applications/software-change-publication-executor.ts';
import { githubCliProcessEnvironment } from '../github/github-cli.ts';

const executeFile = promisify(execFile);
const commandTimeoutMs = 60_000;

type CommandResult = { stdout: string; stderr: string; exitCode: number };
type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; allowFailure?: boolean },
) => Promise<CommandResult>;

export const githubPublicationProcessEnvironment = githubCliProcessEnvironment;

async function defaultRunner(
  command: string,
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): Promise<CommandResult> {
  try {
    const result = await executeFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: commandTimeoutMs,
      env: githubCliProcessEnvironment(),
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
    throw new SoftwareChangePublicationExecutionError(
      'The local Git or GitHub command could not be completed.',
      'publication_failed',
    );
  }
}

function trimmed(value: string): string {
  return value.trim();
}

function parseGitHubRemote(value: string): { owner: string; name: string } {
  const remote = value.trim();
  let path: string | undefined;
  const scp = /^(?:git@)?github\.com:([^?#]+)$/u.exec(remote);
  if (scp?.[1] !== undefined) {
    path = scp[1];
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new SoftwareChangePublicationExecutionError(
        'The origin remote is not a supported GitHub repository URL.',
        'publication_conflict',
      );
    }
    if (
      url.hostname.toLowerCase() !== 'github.com' ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (url.protocol === 'https:' && url.username.length > 0)
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The origin remote must be a credential-free GitHub URL.',
        'publication_conflict',
      );
    }
    path = url.pathname.replace(/^\/+|\/+$/gu, '');
  }
  const parts = path.replace(/\.git$/u, '').split('/');
  const [owner, name] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    name === undefined ||
    !/^[A-Za-z0-9_.-]{1,100}$/u.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/u.test(name)
  ) {
    throw new SoftwareChangePublicationExecutionError(
      'The origin remote does not identify one GitHub owner and repository.',
      'publication_conflict',
    );
  }
  return { owner, name };
}

function requireSuccessfulApplication(
  application: SoftwareChangeApplication,
): asserts application is SoftwareChangeApplication & {
  result: NonNullable<SoftwareChangeApplication['result']>;
} {
  if (application.status !== 'succeeded' || application.result === undefined) {
    throw new SoftwareChangePublicationExecutionError(
      'Only a successfully staged software-change application can be published.',
      'publication_conflict',
    );
  }
}

function assertSafeBranch(value: string, label: string): void {
  if (
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('@{') ||
    /[\s~^:?*[\\\]]/u.test(value) ||
    value.endsWith('.') ||
    value.endsWith('/') ||
    value.includes('//')
  ) {
    throw new SoftwareChangePublicationExecutionError(
      `${label} is not a safe Git branch name.`,
      'publication_conflict',
    );
  }
}

const PullRequestRecordSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.url(),
    title: z.string(),
    body: z.string(),
    isDraft: z.boolean(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    headRefOid: z.string().regex(/^[a-f0-9]{40,64}$/u),
    baseRefName: z.string().min(1),
  })
  .strict();
type PullRequestRecord = z.infer<typeof PullRequestRecordSchema>;

function parsePullRequests(value: string): PullRequestRecord[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return z.array(PullRequestRecordSchema).parse(parsed);
  } catch {
    throw new SoftwareChangePublicationExecutionError(
      'GitHub returned an invalid pull-request response.',
      'publication_failed',
    );
  }
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n/gu, '\n').replace(/\n+$/u, '');
}

function expectedStatus(operation: 'create' | 'update' | 'delete'): string {
  return operation === 'create' ? 'A' : operation === 'update' ? 'M' : 'D';
}

function filePathWithinWorkspace(workspacePath: string, relativePath: string) {
  const workspace = resolve(workspacePath);
  const path = resolve(workspace, relativePath);
  if (path === workspace || !path.startsWith(`${workspace}${sep}`)) {
    throw new SoftwareChangePublicationExecutionError(
      'The staged application contains a file outside its managed worktree.',
      'publication_conflict',
    );
  }
  return path;
}

async function assertAppliedFileIntegrity(
  workspacePath: string,
  files: ChangeApplicationFile[],
) {
  for (const file of files) {
    const path = filePathWithinWorkspace(workspacePath, file.relativePath);
    if (file.operation === 'delete') {
      try {
        await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new SoftwareChangePublicationExecutionError(
          'Vera could not verify the staged application files.',
          'publication_failed',
        );
      }
      throw new SoftwareChangePublicationExecutionError(
        'A deleted file from the staged application is present in the managed worktree.',
        'review_required',
      );
    }
    let content: Buffer;
    try {
      const information = await lstat(path);
      if (!information.isFile() || information.isSymbolicLink()) {
        throw new SoftwareChangePublicationExecutionError(
          'A changed file from the staged application is not a regular file.',
          'review_required',
        );
      }
      content = await readFile(path);
    } catch (error) {
      if (error instanceof SoftwareChangePublicationExecutionError) throw error;
      throw new SoftwareChangePublicationExecutionError(
        'A changed file from the staged application is unavailable in the managed worktree.',
        'review_required',
      );
    }
    const digest = createHash('sha256').update(content).digest('hex');
    if (content.byteLength !== file.bytes || digest !== file.afterSha256) {
      throw new SoftwareChangePublicationExecutionError(
        'The staged application bytes differ from its durable result.',
        'review_required',
      );
    }
  }
}

function stagedEntries(output: string) {
  const fields = output.split('\u0000');
  const entries: { status: string; path: string }[] = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status !== undefined && path !== undefined && status.length > 0) {
      entries.push({ status, path });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export class GitHubSoftwareChangePublicationExecutor
  implements SoftwareChangePublicationExecutor
{
  public readonly adapterId = 'github_gh_cli' as const;
  private readonly gitCommand: string;
  private readonly ghCommand: string;
  private readonly run: CommandRunner;
  private readonly clock: () => string;

  public constructor(
    options: {
      gitCommand?: string;
      ghCommand?: string;
      run?: CommandRunner;
      clock?: () => string;
    } = {},
  ) {
    this.gitCommand = options.gitCommand ?? 'git';
    this.ghCommand = options.ghCommand ?? 'gh';
    this.run = options.run ?? defaultRunner;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async checkReadiness(): Promise<void> {
    try {
      await Promise.all([
        this.run(this.gitCommand, ['--version']),
        this.run(this.ghCommand, ['auth', 'status']),
      ]);
    } catch {
      throw new SoftwareChangePublicationExecutionError(
        'Git publication requires available Git and an authenticated GitHub CLI.',
        'publication_unavailable',
      );
    }
  }

  public async prepare(input: {
    application: SoftwareChangeApplication;
    project: Project;
    baseBranch: string;
    commitMessage: string;
    pullRequest: { title: string; body: string; draft: boolean };
  }): Promise<PublicationEffect> {
    await this.checkReadiness();
    requireSuccessfulApplication(input.application);
    if (input.application.project.id !== input.project.id) {
      throw new SoftwareChangePublicationExecutionError(
        'The staged application does not belong to the selected project.',
        'publication_conflict',
      );
    }
    const result = input.application.result;
    assertSafeBranch(input.baseBranch, 'The pull-request base branch');
    assertSafeBranch(result.branchName, 'The staged head branch');
    if (
      !result.branchName.startsWith('vera/change-') ||
      result.branchName === input.baseBranch
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'Publication requires a Vera-managed head branch distinct from the base branch.',
        'publication_conflict',
      );
    }
    const [head, branch, tree, name, email, remote, staged, unstaged] =
      await Promise.all([
        this.git(result.workspacePath, ['rev-parse', 'HEAD']),
        this.git(result.workspacePath, ['branch', '--show-current']),
        this.git(result.workspacePath, ['write-tree']),
        this.git(result.workspacePath, ['config', '--get', 'user.name']),
        this.git(result.workspacePath, ['config', '--get', 'user.email']),
        this.git(result.workspacePath, ['remote', 'get-url', 'origin']),
        this.git(result.workspacePath, [
          'diff',
          '--cached',
          '--name-status',
          '-z',
          '--no-renames',
          '--',
        ]),
        this.git(result.workspacePath, ['diff', '--name-only', '--']),
      ]);
    if (trimmed(branch.stdout) !== result.branchName) {
      throw new SoftwareChangePublicationExecutionError(
        'The managed worktree is no longer on its approved Vera branch.',
        'review_required',
      );
    }
    const expected = result.files
      .map((file) => ({
        status: expectedStatus(file.operation),
        path: file.relativePath,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    let treeRevision = trimmed(tree.stdout);
    let author = { name: trimmed(name.stdout), email: trimmed(email.stdout) };
    if (trimmed(head.stdout) === result.baseRevision) {
      if (
        JSON.stringify(stagedEntries(staged.stdout)) !==
          JSON.stringify(expected) ||
        trimmed(unstaged.stdout).length > 0
      ) {
        throw new SoftwareChangePublicationExecutionError(
          'The managed worktree no longer contains only the staged application effect.',
          'review_required',
        );
      }
    } else {
      const revision = trimmed(head.stdout);
      const [
        parent,
        commitTree,
        message,
        authorName,
        authorEmail,
        committedFiles,
      ] = await Promise.all([
        this.git(result.workspacePath, ['rev-parse', `${revision}^`]),
        this.git(result.workspacePath, ['rev-parse', `${revision}^{tree}`]),
        this.git(result.workspacePath, ['show', '-s', '--format=%B', revision]),
        this.git(result.workspacePath, [
          'show',
          '-s',
          '--format=%an',
          revision,
        ]),
        this.git(result.workspacePath, [
          'show',
          '-s',
          '--format=%ae',
          revision,
        ]),
        this.git(result.workspacePath, [
          'diff',
          '--name-status',
          '-z',
          '--no-renames',
          result.baseRevision,
          revision,
          '--',
        ]),
      ]);
      if (
        trimmed(parent.stdout) !== result.baseRevision ||
        trimmed(message.stdout) !== input.commitMessage.trim() ||
        JSON.stringify(stagedEntries(committedFiles.stdout)) !==
          JSON.stringify(expected) ||
        trimmed(staged.stdout).length > 0 ||
        trimmed(unstaged.stdout).length > 0
      ) {
        throw new SoftwareChangePublicationExecutionError(
          'The managed worktree contains a commit that differs from this publication request.',
          'review_required',
        );
      }
      treeRevision = trimmed(commitTree.stdout);
      author = {
        name: trimmed(authorName.stdout),
        email: trimmed(authorEmail.stdout),
      };
    }
    if (author.name.length === 0 || !/^\S+@\S+\.\S+$/u.test(author.email)) {
      throw new SoftwareChangePublicationExecutionError(
        'Git user.name and user.email must be configured before publication.',
        'publication_conflict',
      );
    }
    await assertAppliedFileIntegrity(result.workspacePath, result.files);
    const repository = parseGitHubRemote(remote.stdout);
    const slug = `${repository.owner}/${repository.name}`;
    const baseBranchRevision = await this.remoteRevision(
      result.workspacePath,
      'origin',
      `refs/heads/${input.baseBranch}`,
    );
    if (baseBranchRevision === null) {
      throw new SoftwareChangePublicationExecutionError(
        'The pull-request base branch does not exist on the origin remote.',
        'publication_conflict',
      );
    }
    if (baseBranchRevision !== result.baseRevision) {
      throw new SoftwareChangePublicationExecutionError(
        'The staged change is not based on the current origin base branch and must be regenerated before publication.',
        'review_required',
      );
    }
    const viewed = await this.run(this.ghCommand, [
      'repo',
      'view',
      slug,
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]);
    if (trimmed(viewed.stdout).toLowerCase() !== slug.toLowerCase()) {
      throw new SoftwareChangePublicationExecutionError(
        'The authenticated GitHub account cannot verify the origin repository.',
        'publication_conflict',
      );
    }
    return {
      adapterId: this.adapterId,
      repository: { remoteName: 'origin', ...repository },
      baseRevision: result.baseRevision,
      baseBranch: input.baseBranch,
      baseBranchRevision,
      headBranch: result.branchName,
      workspacePath: result.workspacePath,
      treeRevision,
      files: structuredClone(result.files),
      author,
      commitMessage: input.commitMessage.trim(),
      pullRequest: {
        title: input.pullRequest.title.trim(),
        body: input.pullRequest.body,
        draft: input.pullRequest.draft,
      },
      authority: {
        commit: 'create_one',
        push: 'create_or_verify_head',
        pullRequest: 'create_or_verify',
        directBasePush: false,
        forcePush: false,
      },
    };
  }

  public async execute(input: {
    publication: SoftwareChangePublication;
    application: SoftwareChangeApplication;
    project: Project;
  }): Promise<SoftwareChangePublicationResult> {
    requireSuccessfulApplication(input.application);
    const approved = input.publication.approval.effect;
    if (
      input.publication.sourceApplication.id !== input.application.id ||
      input.publication.sourceApplication.effectId !==
        input.application.effect.id ||
      input.publication.sourceApplication.version !==
        input.application.version ||
      input.application.project.id !== input.project.id
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The staged source application changed after publication approval.',
        'publication_conflict',
      );
    }
    const slug = `${approved.repository.owner}/${approved.repository.name}`;
    const currentRemote = parseGitHubRemote(
      (
        await this.git(approved.workspacePath, [
          'remote',
          'get-url',
          approved.repository.remoteName,
        ])
      ).stdout,
    );
    if (
      currentRemote.owner.toLowerCase() !==
        approved.repository.owner.toLowerCase() ||
      currentRemote.name.toLowerCase() !==
        approved.repository.name.toLowerCase()
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The Git remote changed after publication approval.',
        'review_required',
      );
    }
    let commitRevision = trimmed(
      (await this.git(approved.workspacePath, ['rev-parse', 'HEAD'])).stdout,
    );
    const currentBaseBranchRevision = await this.remoteRevision(
      approved.workspacePath,
      approved.repository.remoteName,
      `refs/heads/${approved.baseBranch}`,
    );
    if (currentBaseBranchRevision !== approved.baseBranchRevision) {
      throw new SoftwareChangePublicationExecutionError(
        'The pull-request base branch moved after approval and requires a new publication review.',
        'review_required',
      );
    }
    if (commitRevision === approved.baseRevision) {
      const [branch, tree, staged, unstaged] = await Promise.all([
        this.git(approved.workspacePath, ['branch', '--show-current']),
        this.git(approved.workspacePath, ['write-tree']),
        this.git(approved.workspacePath, [
          'diff',
          '--cached',
          '--name-status',
          '-z',
          '--no-renames',
          '--',
        ]),
        this.git(approved.workspacePath, ['diff', '--name-only', '--']),
      ]);
      const expected = approved.files
        .map((file) => ({
          status: expectedStatus(file.operation),
          path: file.relativePath,
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      if (
        trimmed(branch.stdout) !== approved.headBranch ||
        trimmed(tree.stdout) !== approved.treeRevision ||
        JSON.stringify(stagedEntries(staged.stdout)) !==
          JSON.stringify(expected) ||
        trimmed(unstaged.stdout).length > 0
      ) {
        throw new SoftwareChangePublicationExecutionError(
          'The staged Git tree changed after publication approval.',
          'review_required',
        );
      }
      const committed = await this.git(
        approved.workspacePath,
        [
          '-c',
          'commit.gpgSign=false',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '--no-gpg-sign',
          '--message',
          approved.commitMessage,
          '--',
        ],
        true,
      );
      commitRevision = trimmed(
        (await this.git(approved.workspacePath, ['rev-parse', 'HEAD'])).stdout,
      );
      if (
        committed.exitCode !== 0 &&
        commitRevision === approved.baseRevision
      ) {
        throw new SoftwareChangePublicationExecutionError(
          'Git could not create the approved commit.',
          'publication_failed',
        );
      }
    }
    await this.assertApprovedCommit(approved, commitRevision);

    const remoteRef = `refs/heads/${approved.headBranch}`;
    let remoteRevision = await this.remoteRevision(
      approved.workspacePath,
      approved.repository.remoteName,
      remoteRef,
    );
    if (remoteRevision === null) {
      const pushed = await this.git(
        approved.workspacePath,
        [
          'push',
          '--set-upstream',
          approved.repository.remoteName,
          `HEAD:${remoteRef}`,
        ],
        true,
      );
      remoteRevision = await this.remoteRevision(
        approved.workspacePath,
        approved.repository.remoteName,
        remoteRef,
      );
      if (pushed.exitCode !== 0 && remoteRevision !== commitRevision) {
        throw new SoftwareChangePublicationExecutionError(
          'The Vera branch could not be created on GitHub.',
          'publication_failed',
        );
      }
    }
    if (remoteRevision !== commitRevision) {
      throw new SoftwareChangePublicationExecutionError(
        'The remote Vera branch exists at a different commit and requires review.',
        'review_required',
      );
    }

    let pullRequests = await this.findPullRequests(slug, approved);
    if (pullRequests.length === 0) {
      let createFailed: boolean;
      const directory = await mkdtemp(join(tmpdir(), 'vera-pr-'));
      const bodyPath = join(directory, 'body.md');
      try {
        await writeFile(bodyPath, approved.pullRequest.body, { mode: 0o600 });
        const created = await this.run(
          this.ghCommand,
          [
            'pr',
            'create',
            '--repo',
            slug,
            '--base',
            approved.baseBranch,
            '--head',
            approved.headBranch,
            '--title',
            approved.pullRequest.title,
            '--body-file',
            bodyPath,
            ...(approved.pullRequest.draft ? ['--draft'] : []),
          ],
          { allowFailure: true },
        );
        createFailed = created.exitCode !== 0;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      pullRequests = await this.findPullRequests(slug, approved);
      if (createFailed && pullRequests.length === 0) {
        throw new SoftwareChangePublicationExecutionError(
          'GitHub could not create the approved pull request.',
          'publication_failed',
        );
      }
    }
    if (pullRequests.length !== 1) {
      throw new SoftwareChangePublicationExecutionError(
        'Vera found an ambiguous pull-request state for the approved branch.',
        'review_required',
      );
    }
    const pullRequest = pullRequests[0];
    if (pullRequest === undefined) {
      throw new SoftwareChangePublicationExecutionError(
        'Vera could not resolve the approved pull request.',
        'publication_failed',
      );
    }
    if (
      pullRequest.headRefOid !== commitRevision ||
      pullRequest.state !== 'OPEN' ||
      pullRequest.baseRefName !== approved.baseBranch ||
      pullRequest.title !== approved.pullRequest.title ||
      normalizeBody(pullRequest.body) !==
        normalizeBody(approved.pullRequest.body) ||
      pullRequest.isDraft !== approved.pullRequest.draft
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The existing pull request differs from the approved publication.',
        'review_required',
      );
    }
    const finalBaseBranchRevision = await this.remoteRevision(
      approved.workspacePath,
      approved.repository.remoteName,
      `refs/heads/${approved.baseBranch}`,
    );
    if (finalBaseBranchRevision !== approved.baseBranchRevision) {
      throw new SoftwareChangePublicationExecutionError(
        'The pull-request base branch moved while publication was in progress and requires a new review.',
        'review_required',
      );
    }
    return {
      adapterId: this.adapterId,
      commitRevision,
      remoteBranch: approved.headBranch,
      pullRequest: {
        number: pullRequest.number,
        url: pullRequest.url,
        baseBranch: pullRequest.baseRefName,
        headBranch: approved.headBranch,
        draft: pullRequest.isDraft,
      },
      publishedAt: this.clock(),
    };
  }

  private git(cwd: string, args: string[], allowFailure = false) {
    return this.run(this.gitCommand, ['-C', cwd, ...args], { allowFailure });
  }

  private async assertApprovedCommit(
    effect: PublicationEffect,
    revision: string,
  ) {
    const [parent, tree, subject, authorName, authorEmail] = await Promise.all([
      this.git(effect.workspacePath, ['rev-parse', `${revision}^`]),
      this.git(effect.workspacePath, ['rev-parse', `${revision}^{tree}`]),
      this.git(effect.workspacePath, ['show', '-s', '--format=%B', revision]),
      this.git(effect.workspacePath, ['show', '-s', '--format=%an', revision]),
      this.git(effect.workspacePath, ['show', '-s', '--format=%ae', revision]),
    ]);
    if (
      trimmed(parent.stdout) !== effect.baseRevision ||
      trimmed(tree.stdout) !== effect.treeRevision ||
      trimmed(subject.stdout) !== effect.commitMessage ||
      trimmed(authorName.stdout) !== effect.author.name ||
      trimmed(authorEmail.stdout) !== effect.author.email
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The local commit differs from the approved publication.',
        'review_required',
      );
    }
  }

  private async remoteRevision(cwd: string, remote: string, ref: string) {
    const result = await this.git(cwd, ['ls-remote', '--heads', remote, ref]);
    const line = result.stdout.trim();
    if (line.length === 0) return null;
    const [revision, returnedRef] = line.split(/\s+/u);
    if (
      revision === undefined ||
      returnedRef !== ref ||
      !/^[a-f0-9]{40,64}$/u.test(revision)
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The remote branch response was invalid.',
        'publication_failed',
      );
    }
    return revision;
  }

  private async findPullRequests(slug: string, effect: PublicationEffect) {
    const result = await this.run(this.ghCommand, [
      'pr',
      'list',
      '--repo',
      slug,
      '--head',
      effect.headBranch,
      '--base',
      effect.baseBranch,
      '--state',
      'all',
      '--json',
      'number,url,title,body,isDraft,state,headRefOid,baseRefName',
      '--limit',
      '10',
    ]);
    return parsePullRequests(result.stdout);
  }
}
