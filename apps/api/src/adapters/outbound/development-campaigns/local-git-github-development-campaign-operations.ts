import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { z } from 'zod';

import type { SoftwareChangePublication } from '../../../domain/changes/software-change-publication.ts';
import type { SoftwareChangeApplication } from '../../../domain/changes/software-change-application.ts';
import {
  DevelopmentCampaignEffectSchema,
  DevelopmentCampaignPolicySummarySchema,
  PullRequestObservationSchema,
  type DevelopmentCampaign,
  type DevelopmentCampaignCatalog,
  type DevelopmentCampaignEffect,
  type DevelopmentCampaignRepair,
} from '../../../domain/development-campaigns/development-campaign.ts';
import type { Project } from '../../../domain/projects/project.ts';
import {
  DevelopmentCampaignOperationError,
  type DevelopmentCampaignOperations,
} from '../../../ports/development-campaigns/development-campaign-operations.ts';
import {
  boundedEvidenceText,
  readGitHubReviewEvidence,
} from './github-review-evidence.ts';

const executeFile = promisify(execFile);
const maxCommandOutputBytes = 8_000;
const builtInProtectedPrefixes = [
  '.env',
  '.git/',
  '.github/',
  'package.json',
  'package-lock.json',
  'config/development-campaigns',
  'docs/decisions/',
  'docs/security-and-trust.md',
  'apps/api/src/bootstrap/',
  'apps/api/src/adapters/inbound/http/routes/development-campaign-routes.ts',
  'apps/api/src/adapters/outbound/development-campaigns/',
  'apps/api/src/adapters/outbound/persistence/memory/in-memory-development-campaign-store.ts',
  'apps/api/src/adapters/outbound/persistence/mongodb/mongodb-development-campaign-store.ts',
  'apps/api/src/domain/development-campaigns/',
  'apps/api/src/application/development-campaigns/',
  'apps/api/src/ports/development-campaigns/',
  'apps/api/src/ports/persistence/development-campaign-store.ts',
] as const;

type CommandResult = { stdout: string; stderr: string; exitCode: number };
type CommandRunner = (
  command: string,
  arguments_: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    allowFailure?: boolean;
    environment?: NodeJS.ProcessEnv;
  },
) => Promise<CommandResult>;

const processEnvironmentKeys = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'USERPROFILE',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'SSH_AUTH_SOCK',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_HOST',
  'GH_ENTERPRISE_TOKEN',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
] as const;

const qualityGateEnvironmentKeys = [
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
] as const;

function campaignProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: '1',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
  };
  for (const key of processEnvironmentKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function qualityGateEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: '1',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
  };
  for (const key of qualityGateEnvironmentKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function defaultRunner(
  command: string,
  arguments_: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    allowFailure?: boolean;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<CommandResult> {
  try {
    const result = await executeFile(command, arguments_, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      env: options.environment ?? campaignProcessEnvironment(),
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: NodeJS.Signals;
    };
    if (
      options.allowFailure === true &&
      (typeof failure.code === 'number' ||
        failure.killed === true ||
        failure.signal !== undefined)
    ) {
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        exitCode:
          typeof failure.code === 'number'
            ? failure.code
            : failure.killed === true
              ? 124
              : 1,
      };
    }
    throw new DevelopmentCampaignOperationError(
      'A configured development-campaign command could not be completed.',
      'campaign_conflict',
    );
  }
}

function trim(value: string): string {
  return value.trim();
}

function boundedOutput(stdout: string, stderr: string): string {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  const bytes = Buffer.from(output);
  if (bytes.byteLength <= maxCommandOutputBytes) return output;
  const prefix = Buffer.from('[earlier output omitted]\n');
  return Buffer.concat([
    prefix,
    bytes.subarray(
      bytes.byteLength - (maxCommandOutputBytes - prefix.byteLength),
    ),
  ]).toString('utf8');
}

function assertSafeBranch(value: string): void {
  if (
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('@{') ||
    /[\s~^:?*[\\\]]/u.test(value) ||
    value.endsWith('.') ||
    value.endsWith('/') ||
    value.includes('//')
  ) {
    throw new DevelopmentCampaignOperationError(
      'The configured campaign base branch is unsafe.',
      'campaign_conflict',
    );
  }
}

function parseGitHubRemote(value: string): { owner: string; name: string } {
  const remote = value.trim();
  let path: string | undefined;
  const scp = /^(?:git@)?github\.com:([^?#]+)$/u.exec(remote);
  if (scp?.[1] !== undefined) path = scp[1];
  else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new DevelopmentCampaignOperationError(
        'The project origin is not a supported GitHub repository.',
        'campaign_conflict',
      );
    }
    if (
      url.hostname.toLowerCase() !== 'github.com' ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (url.protocol === 'https:' && url.username.length > 0)
    ) {
      throw new DevelopmentCampaignOperationError(
        'The project origin must be a credential-free GitHub URL.',
        'campaign_conflict',
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
    throw new DevelopmentCampaignOperationError(
      'The project origin does not identify one GitHub repository.',
      'campaign_conflict',
    );
  }
  return { owner, name };
}

const GitHubPullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.url(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    isDraft: z.boolean(),
    headRefOid: z.string().regex(/^[a-f0-9]{40,64}$/u),
    baseRefOid: z.string().regex(/^[a-f0-9]{40,64}$/u),
    mergeStateStatus: z.string().min(1),
    reviewDecision: z.string().nullable().optional(),
    statusCheckRollup: z.array(z.record(z.string(), z.unknown())),
    reviews: z
      .array(
        z
          .object({
            author: z
              .object({ login: z.string() })
              .loose()
              .nullable()
              .optional(),
            body: z.string().optional(),
            state: z.string().optional(),
            url: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
    comments: z
      .array(
        z
          .object({
            author: z
              .object({ login: z.string() })
              .loose()
              .nullable()
              .optional(),
            body: z.string().optional(),
            url: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
    mergeCommit: z
      .object({ oid: z.string().regex(/^[a-f0-9]{40,64}$/u) })
      .nullable()
      .optional(),
  })
  .loose();

type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>;

function checkClassification(check: Record<string, unknown>) {
  const status =
    typeof check.status === 'string' ? check.status.toUpperCase() : '';
  const conclusion =
    typeof check.conclusion === 'string'
      ? check.conclusion.toUpperCase()
      : typeof check.state === 'string'
        ? check.state.toUpperCase()
        : '';
  if (status !== '' && status !== 'COMPLETED') return 'pending' as const;
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion))
    return 'passed' as const;
  if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', ''].includes(conclusion))
    return 'pending' as const;
  return 'failed' as const;
}

function normalizedReviewDecision(value: string | null | undefined) {
  return ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(
    value ?? '',
  )
    ? (value as 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED')
    : ('NONE' as const);
}

function normalizedPrefix(value: string): string {
  return value.replace(/^\.\//u, '').replace(/\\/gu, '/');
}

function pathIsProtected(path: string, prefixes: readonly string[]) {
  const normalized = normalizedPrefix(path);
  return prefixes.some((candidate) => {
    const prefix = normalizedPrefix(candidate);
    const exact = prefix.replace(/\/$/u, '');
    return normalized === exact || normalized.startsWith(prefix);
  });
}

export class LocalGitGitHubDevelopmentCampaignOperations
  implements DevelopmentCampaignOperations
{
  public readonly adapterId = 'local_git_github' as const;
  private readonly run: CommandRunner;
  private readonly clock: () => string;

  public constructor(
    private readonly options: {
      catalog: DevelopmentCampaignCatalog;
      gitCommand?: string;
      ghCommand?: string;
      run?: CommandRunner;
      clock?: () => string;
    },
  ) {
    this.run = options.run ?? defaultRunner;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async checkReadiness() {
    await Promise.all([
      this.run(this.gitCommand, ['--version']),
      this.run(this.ghCommand, ['auth', 'status']),
    ]);
  }

  public listPolicies(projects: Project[]) {
    return this.options.catalog.policies.flatMap((policy) => {
      const project = projects.find(
        (candidate) =>
          resolve(candidate.source.rootPath) === resolve(policy.projectRoot),
      );
      if (project === undefined) return [];
      return [
        DevelopmentCampaignPolicySummarySchema.parse({
          schemaVersion: 1,
          id: policy.id,
          project: { id: project.id, displayName: project.displayName },
          baseBranch: policy.baseBranch,
          qualityGates: policy.qualityGates.map(({ id, label, timeoutMs }) => ({
            id,
            label,
            timeoutMs,
          })),
          limits: policy.limits,
          merge: policy.merge,
        }),
      ];
    });
  }

  public async prepare(input: {
    project: Project;
    policyId: string;
    objective: string;
    ticket: { reference: string; details: string };
    delivery: DevelopmentCampaignEffect['delivery'];
    capabilities: DevelopmentCampaignEffect['capabilities'];
    completionMode?: 'policy' | 'pull_request_only';
    approvalController?: DevelopmentCampaignEffect['approvalController'];
  }): Promise<DevelopmentCampaignEffect> {
    const projectRoot = resolve(input.project.source.rootPath);
    const policy = this.options.catalog.policies.find(
      (candidate) =>
        candidate.id === input.policyId &&
        resolve(candidate.projectRoot) === projectRoot,
    );
    if (policy === undefined) {
      throw new DevelopmentCampaignOperationError(
        'No development-campaign policy authorizes this project.',
        'campaign_conflict',
      );
    }
    assertSafeBranch(policy.baseBranch);
    for (const gate of policy.qualityGates) {
      if (!isAbsolute(gate.executable)) {
        throw new DevelopmentCampaignOperationError(
          `Quality gate ${gate.id} must use an absolute executable path.`,
          'campaign_conflict',
        );
      }
    }
    const [branch, head, remoteHead, remote, status] = await Promise.all([
      this.git(projectRoot, ['branch', '--show-current']),
      this.git(projectRoot, ['rev-parse', 'HEAD']),
      this.remoteRevision(projectRoot, policy.baseBranch),
      this.git(projectRoot, ['remote', 'get-url', 'origin']),
      this.git(projectRoot, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
    ]);
    if (
      trim(branch.stdout) !== policy.baseBranch ||
      remoteHead === null ||
      trim(head.stdout) !== remoteHead ||
      trim(status.stdout).length > 0
    ) {
      throw new DevelopmentCampaignOperationError(
        'The project must be clean, on the configured base branch, and synchronized with origin before campaign approval.',
        'campaign_conflict',
      );
    }
    const protectedPathPrefixes = [
      ...new Set([
        ...builtInProtectedPrefixes,
        ...policy.protectedPathPrefixes.map(normalizedPrefix),
      ]),
    ].sort();
    return DevelopmentCampaignEffectSchema.parse({
      adapterId: this.adapterId,
      completionMode: input.completionMode ?? 'policy',
      approvalController: input.approvalController ?? { kind: 'owner' },
      policyId: policy.id,
      project: { id: input.project.id, displayName: input.project.displayName },
      repository: parseGitHubRemote(remote.stdout),
      baseBranch: policy.baseBranch,
      baseRevision: remoteHead,
      objective: input.objective,
      ticket: input.ticket,
      delivery: input.delivery,
      capabilities: input.capabilities,
      qualityGates: policy.qualityGates,
      protectedPathPrefixes,
      limits: policy.limits,
      merge: {
        ...policy.merge,
        enabled:
          input.completionMode === 'pull_request_only'
            ? false
            : policy.merge.enabled,
        requireReviewApproval:
          input.completionMode === 'pull_request_only'
            ? false
            : policy.merge.requireReviewApproval,
        synchronizeLocalBase:
          input.completionMode === 'pull_request_only'
            ? false
            : policy.merge.synchronizeLocalBase,
      },
      authority: {
        implementation: 'bounded_capabilities',
        application: 'exact_generated_patch',
        verification: 'configured_commands',
        publication: 'create_one_pull_request',
        observation: 'github_checks_and_reviews',
        merge:
          input.completionMode === 'pull_request_only'
            ? 'prohibited'
            : 'policy_gated_exact_head',
        directBasePush: false,
        forcePush: false,
        policyMutation: false,
      },
    });
  }

  public async assertProjectBase(input: {
    project: Project;
    effect: DevelopmentCampaignEffect;
  }) {
    if (input.project.id !== input.effect.project.id) {
      throw new DevelopmentCampaignOperationError(
        'The campaign project identity changed after approval.',
        'campaign_conflict',
      );
    }
    const [branch, head, remoteHead, status] = await Promise.all([
      this.git(input.project.source.rootPath, ['branch', '--show-current']),
      this.git(input.project.source.rootPath, ['rev-parse', 'HEAD']),
      this.remoteRevision(
        input.project.source.rootPath,
        input.effect.baseBranch,
      ),
      this.git(input.project.source.rootPath, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
    ]);
    if (
      trim(branch.stdout) !== input.effect.baseBranch ||
      trim(head.stdout) !== input.effect.baseRevision ||
      remoteHead !== input.effect.baseRevision ||
      trim(status.stdout).length > 0
    ) {
      throw new DevelopmentCampaignOperationError(
        'The project base changed after campaign approval.',
        'review_required',
      );
    }
  }

  public async verify(input: {
    campaign: DevelopmentCampaign;
    application: import('../../../domain/changes/software-change-application.ts').SoftwareChangeApplication;
  }) {
    const effect = input.campaign.approval.effect;
    const sourceRevision =
      input.campaign.attempts.at(-1)?.sourceRevision ?? effect.baseRevision;
    const result = input.application.result;
    if (
      input.application.status !== 'succeeded' ||
      result === undefined ||
      input.application.project.id !== effect.project.id ||
      result.baseRevision !== sourceRevision
    ) {
      throw new DevelopmentCampaignOperationError(
        'The staged application does not match the approved campaign base.',
        'campaign_conflict',
      );
    }
    const changedBytes = result.files.reduce(
      (total, file) => total + file.bytes,
      0,
    );
    if (
      result.files.length > effect.limits.maxChangedFiles ||
      changedBytes > effect.limits.maxChangedBytes ||
      result.files.some((file) =>
        pathIsProtected(file.relativePath, effect.protectedPathPrefixes),
      )
    ) {
      throw new DevelopmentCampaignOperationError(
        'The generated change exceeds campaign limits or modifies a protected path.',
        'review_required',
      );
    }
    const gates: NonNullable<
      DevelopmentCampaign['attempts'][number]['verification']
    >['gates'] = [];
    for (const gate of effect.qualityGates) {
      const startedAt = performance.now();
      const command = await this.run(gate.executable, gate.arguments, {
        cwd: result.workspacePath,
        timeoutMs: gate.timeoutMs,
        allowFailure: true,
        environment: qualityGateEnvironment(),
      });
      gates.push({
        id: gate.id,
        label: gate.label,
        status: command.exitCode === 0 ? 'passed' : 'failed',
        exitCode: command.exitCode,
        durationMs: Math.round(performance.now() - startedAt),
        output: boundedOutput(command.stdout, command.stderr),
      });
      if (command.exitCode !== 0) break;
    }
    return {
      status: gates.every((gate) => gate.status === 'passed')
        ? ('passed' as const)
        : ('failed' as const),
      checkedAt: this.clock(),
      gates,
    };
  }

  public async observe(input: {
    campaign: DevelopmentCampaign;
    publication: SoftwareChangePublication;
  }) {
    const pullRequest = await this.pullRequest(
      input.campaign,
      input.publication,
    );
    const counts = { total: 0, pending: 0, passed: 0, failed: 0 };
    for (const check of pullRequest.statusCheckRollup) {
      counts.total += 1;
      counts[checkClassification(check)] += 1;
    }
    const enrichment =
      counts.failed > 0 ||
      normalizedReviewDecision(pullRequest.reviewDecision) ===
        'CHANGES_REQUESTED'
        ? await readGitHubReviewEvidence({
            run: this.run,
            ghCommand: this.ghCommand,
            repositorySlug: this.slug(input.campaign.approval.effect),
            pullRequest,
          })
        : { failedChecks: [], reviewFeedback: [] };
    const failedChecks = (
      enrichment.failedChecks.length > 0
        ? enrichment.failedChecks
        : pullRequest.statusCheckRollup.flatMap((check) => {
            if (checkClassification(check) !== 'failed') return [];
            const name = boundedEvidenceText(
              check.name ?? check.context ?? check.workflowName,
              300,
            );
            if (name === undefined) return [];
            const detailsUrl = boundedEvidenceText(check.detailsUrl, 2_000);
            return [
              {
                name,
                status: boundedEvidenceText(check.status, 100) ?? 'COMPLETED',
                conclusion:
                  boundedEvidenceText(check.conclusion ?? check.state, 100) ??
                  'FAILED',
                ...(detailsUrl?.startsWith('https://') === true
                  ? { detailsUrl }
                  : {}),
              },
            ];
          })
    ).slice(0, 20);
    const reviewFeedback = [
      ...(pullRequest.reviews ?? []).flatMap((review) => {
        const body = boundedEvidenceText(review.body);
        if (body === undefined || review.state !== 'CHANGES_REQUESTED')
          return [];
        return [
          {
            kind: 'review' as const,
            author: review.author?.login ?? 'unknown',
            body,
            ...(review.url?.startsWith('https://') === true
              ? { url: review.url }
              : {}),
          },
        ];
      }),
      ...(pullRequest.comments ?? []).flatMap((comment) => {
        const body = boundedEvidenceText(comment.body);
        if (body === undefined) return [];
        return [
          {
            kind: 'comment' as const,
            author: comment.author?.login ?? 'unknown',
            body,
            ...(comment.url?.startsWith('https://') === true
              ? { url: comment.url }
              : {}),
          },
        ];
      }),
      ...enrichment.reviewFeedback,
    ].slice(0, 50);
    return PullRequestObservationSchema.parse({
      checkedAt: this.clock(),
      state: pullRequest.state,
      headRevision: pullRequest.headRefOid,
      baseRevision: pullRequest.baseRefOid,
      checks: counts,
      reviewDecision: normalizedReviewDecision(pullRequest.reviewDecision),
      mergeState: pullRequest.mergeStateStatus,
      ...(failedChecks.length === 0 ? {} : { failedChecks }),
      ...(reviewFeedback.length === 0 ? {} : { reviewFeedback }),
    });
  }

  public async updatePullRequest(input: {
    campaign: DevelopmentCampaign;
    repair: DevelopmentCampaignRepair;
    application: SoftwareChangeApplication;
    publication: SoftwareChangePublication;
  }) {
    const application = input.application.result;
    const publication = input.publication.result;
    const sourceRevision = input.repair.effect.sourceRevision;
    const limits = input.campaign.approval.effect.limits;
    const protectedPrefixes =
      input.campaign.approval.effect.protectedPathPrefixes;
    if (
      application === undefined ||
      input.application.status !== 'succeeded' ||
      application.baseRevision !== sourceRevision ||
      publication === undefined ||
      input.publication.status !== 'succeeded' ||
      input.campaign.publicationId !== input.publication.id ||
      input.campaign.pullRequest?.number !== publication.pullRequest.number ||
      input.campaign.pullRequest.headRevision !== sourceRevision ||
      application.files.length > limits.maxChangedFiles ||
      application.files.reduce((total, file) => total + file.bytes, 0) >
        limits.maxChangedBytes ||
      application.files.some((file) =>
        pathIsProtected(file.relativePath, protectedPrefixes),
      )
    ) {
      throw new DevelopmentCampaignOperationError(
        'The approved repair no longer matches the exact pull request head.',
        'review_required',
      );
    }
    const remoteBefore = await this.remoteRevision(
      application.workspacePath,
      publication.remoteBranch,
    );
    const head = trim(
      (await this.git(application.workspacePath, ['rev-parse', 'HEAD'])).stdout,
    );
    let repairedRevision = head;
    if (head === sourceRevision) {
      const staged = await this.git(
        application.workspacePath,
        ['diff', '--cached', '--quiet'],
        true,
      );
      if (staged.exitCode !== 1 || remoteBefore !== sourceRevision) {
        throw new DevelopmentCampaignOperationError(
          'The repair workspace or remote branch changed before publication.',
          'review_required',
        );
      }
      const author = input.repair.effect.delivery.author;
      await this.run(
        this.gitCommand,
        [
          '-C',
          application.workspacePath,
          'commit',
          '--no-gpg-sign',
          '--message',
          input.repair.effect.delivery.commitMessage,
        ],
        {
          environment: {
            ...campaignProcessEnvironment(),
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_COMMITTER_NAME: author.name,
            GIT_COMMITTER_EMAIL: author.email,
          },
        },
      );
      repairedRevision = trim(
        (await this.git(application.workspacePath, ['rev-parse', 'HEAD']))
          .stdout,
      );
    } else {
      const [parent, message, author] = await Promise.all([
        this.git(application.workspacePath, ['rev-parse', 'HEAD^']),
        this.git(application.workspacePath, [
          'show',
          '-s',
          '--format=%B',
          'HEAD',
        ]),
        this.git(application.workspacePath, [
          'show',
          '-s',
          '--format=%an%x00%ae',
          'HEAD',
        ]),
      ]);
      const expectedAuthor = input.repair.effect.delivery.author;
      if (
        trim(parent.stdout) !== sourceRevision ||
        trim(message.stdout) !== input.repair.effect.delivery.commitMessage ||
        trim(author.stdout) !==
          `${expectedAuthor.name}\u0000${expectedAuthor.email}` ||
        ![sourceRevision, head].includes(remoteBefore ?? '')
      ) {
        throw new DevelopmentCampaignOperationError(
          'An existing repair commit failed exact recovery checks.',
          'review_required',
        );
      }
    }
    const committedPatch = (
      await this.git(application.workspacePath, [
        'diff',
        '--no-ext-diff',
        '--binary',
        '--no-renames',
        sourceRevision,
        repairedRevision,
      ])
    ).stdout;
    if (
      createHash('sha256').update(committedPatch).digest('hex') !==
      application.patchSha256
    ) {
      throw new DevelopmentCampaignOperationError(
        'The repair commit differs from the exact approved patch.',
        'review_required',
      );
    }
    if (remoteBefore !== repairedRevision) {
      const pushed = await this.git(
        application.workspacePath,
        ['push', 'origin', `HEAD:refs/heads/${publication.remoteBranch}`],
        true,
      );
      if (pushed.exitCode !== 0) {
        throw new DevelopmentCampaignOperationError(
          'The existing pull request branch could not be fast-forwarded safely.',
          'review_required',
        );
      }
    }
    const remoteAfter = await this.remoteRevision(
      application.workspacePath,
      publication.remoteBranch,
    );
    if (remoteAfter !== repairedRevision) {
      throw new DevelopmentCampaignOperationError(
        'The remote pull request branch does not match the repair commit.',
        'review_required',
      );
    }
    await this.pullRequest(input.campaign, input.publication, repairedRevision);
    return { headRevision: repairedRevision, previousRevision: sourceRevision };
  }

  public async merge(input: {
    campaign: DevelopmentCampaign;
    project: Project;
    publication: SoftwareChangePublication;
  }) {
    const effect = input.campaign.approval.effect;
    let pullRequest = await this.pullRequest(input.campaign, input.publication);
    if (pullRequest.state !== 'MERGED') {
      const observation = await this.observe(input);
      if (
        observation.state !== 'OPEN' ||
        observation.headRevision !== input.campaign.pullRequest?.headRevision ||
        observation.baseRevision !== effect.baseRevision ||
        observation.checks.total < effect.limits.minimumRequiredChecks ||
        observation.checks.pending > 0 ||
        observation.checks.failed > 0 ||
        (effect.merge.requireReviewApproval &&
          observation.reviewDecision !== 'APPROVED') ||
        observation.reviewDecision === 'CHANGES_REQUESTED' ||
        !['CLEAN', 'HAS_HOOKS'].includes(observation.mergeState)
      ) {
        throw new DevelopmentCampaignOperationError(
          'The pull request does not satisfy the approved merge policy.',
          'review_required',
        );
      }
      await this.run(
        this.ghCommand,
        [
          'pr',
          'merge',
          String(pullRequest.number),
          '--repo',
          this.slug(effect),
          `--${effect.merge.method}`,
          '--match-head-commit',
          pullRequest.headRefOid,
        ],
        { allowFailure: true },
      );
      pullRequest = await this.pullRequest(input.campaign, input.publication);
    }
    const mergeCommit = pullRequest.mergeCommit;
    if (
      pullRequest.state !== 'MERGED' ||
      mergeCommit === null ||
      mergeCommit === undefined
    ) {
      throw new DevelopmentCampaignOperationError(
        'GitHub did not confirm the exact pull request as merged.',
        'merge_failed',
      );
    }
    if (input.project.id !== effect.project.id) {
      throw new DevelopmentCampaignOperationError(
        'The campaign project identity changed before merge.',
        'review_required',
      );
    }
    const projectRoot = input.project.source.rootPath;
    const baseRevision = await this.remoteRevision(
      projectRoot,
      effect.baseBranch,
    );
    if (baseRevision === null) {
      throw new DevelopmentCampaignOperationError(
        'The merged base branch could not be resolved.',
        'merge_failed',
      );
    }
    return {
      mergeRevision: mergeCommit.oid,
      baseRevision,
      mergedAt: this.clock(),
    };
  }

  public async synchronize(input: {
    campaign: DevelopmentCampaign;
    project: Project;
    mergeRevision: string;
    baseRevision: string;
  }) {
    const effect = input.campaign.approval.effect;
    const [branch, head, status] = await Promise.all([
      this.git(input.project.source.rootPath, ['branch', '--show-current']),
      this.git(input.project.source.rootPath, ['rev-parse', 'HEAD']),
      this.git(input.project.source.rootPath, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
    ]);
    if (
      trim(branch.stdout) !== effect.baseBranch ||
      trim(status.stdout).length > 0 ||
      ![effect.baseRevision, input.baseRevision].includes(trim(head.stdout))
    ) {
      throw new DevelopmentCampaignOperationError(
        'The local base checkout changed and cannot be synchronized automatically.',
        'review_required',
      );
    }
    await this.git(input.project.source.rootPath, [
      'fetch',
      '--no-tags',
      'origin',
      effect.baseBranch,
    ]);
    const remote = await this.remoteRevision(
      input.project.source.rootPath,
      effect.baseBranch,
    );
    if (remote !== input.baseRevision) {
      throw new DevelopmentCampaignOperationError(
        'The base branch moved again before local synchronization.',
        'review_required',
      );
    }
    if (trim(head.stdout) !== input.baseRevision) {
      const merged = await this.git(
        input.project.source.rootPath,
        ['merge', '--ff-only', `origin/${effect.baseBranch}`],
        true,
      );
      if (merged.exitCode !== 0) {
        throw new DevelopmentCampaignOperationError(
          'The local base checkout could not be fast-forwarded.',
          'synchronization_failed',
        );
      }
    }
    const finalHead = trim(
      (await this.git(input.project.source.rootPath, ['rev-parse', 'HEAD']))
        .stdout,
    );
    if (finalHead !== input.baseRevision) {
      throw new DevelopmentCampaignOperationError(
        'The synchronized checkout does not match the merged base branch.',
        'synchronization_failed',
      );
    }
    const ancestry = await this.git(
      input.project.source.rootPath,
      ['merge-base', '--is-ancestor', input.mergeRevision, finalHead],
      true,
    );
    if (effect.merge.method !== 'rebase' && ancestry.exitCode !== 0) {
      throw new DevelopmentCampaignOperationError(
        'The synchronized base does not contain the recorded merge revision.',
        'synchronization_failed',
      );
    }
    return { baseRevision: finalHead, synchronizedAt: this.clock() };
  }

  private get gitCommand() {
    return this.options.gitCommand ?? 'git';
  }

  private get ghCommand() {
    return this.options.ghCommand ?? 'gh';
  }

  private git(cwd: string, arguments_: string[], allowFailure = false) {
    return this.run(this.gitCommand, ['-C', cwd, ...arguments_], {
      allowFailure,
    });
  }

  private async remoteRevision(cwd: string, branch: string) {
    const result = await this.git(cwd, [
      'ls-remote',
      '--heads',
      'origin',
      `refs/heads/${branch}`,
    ]);
    const line = trim(result.stdout);
    if (line.length === 0) return null;
    const [revision, ref] = line.split(/\s+/u);
    if (
      revision === undefined ||
      ref !== `refs/heads/${branch}` ||
      !/^[a-f0-9]{40,64}$/u.test(revision)
    ) {
      throw new DevelopmentCampaignOperationError(
        'Git returned an invalid remote branch response.',
        'campaign_conflict',
      );
    }
    return revision;
  }

  private slug(effect: DevelopmentCampaignEffect) {
    return `${effect.repository.owner}/${effect.repository.name}`;
  }

  private async pullRequest(
    campaign: DevelopmentCampaign,
    publication: SoftwareChangePublication,
    expectedHead = campaign.pullRequest?.headRevision ??
      publication.result?.commitRevision,
  ): Promise<GitHubPullRequest> {
    const result = publication.result;
    if (
      publication.status !== 'succeeded' ||
      result === undefined ||
      campaign.publicationId !== publication.id ||
      campaign.approval.effect.repository.owner.toLowerCase() !==
        publication.approval.effect.repository.owner.toLowerCase() ||
      campaign.approval.effect.repository.name.toLowerCase() !==
        publication.approval.effect.repository.name.toLowerCase()
    ) {
      throw new DevelopmentCampaignOperationError(
        'The pull request does not belong to this campaign publication.',
        'publication_failed',
      );
    }
    const response = await this.run(this.ghCommand, [
      'pr',
      'view',
      String(result.pullRequest.number),
      '--repo',
      this.slug(campaign.approval.effect),
      '--json',
      'number,url,state,isDraft,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments,mergeCommit',
    ]);
    try {
      const parsed: unknown = JSON.parse(response.stdout);
      const pullRequest = GitHubPullRequestSchema.parse(parsed);
      if (
        pullRequest.number !== result.pullRequest.number ||
        pullRequest.url !== result.pullRequest.url ||
        pullRequest.isDraft ||
        pullRequest.headRefOid !== expectedHead
      ) {
        throw new Error('identity mismatch');
      }
      return pullRequest;
    } catch {
      throw new DevelopmentCampaignOperationError(
        'GitHub returned a pull request that failed campaign integrity checks.',
        'review_required',
      );
    }
  }
}
