import { z } from 'zod';

import type { CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import {
  WorkItemActionArgumentsSchema,
  WorkItemResultSchema,
  WorkItemSchema,
  type WorkItemActionArguments,
  type WorkItemResult,
} from '../../../../domain/work-items/work-item.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import type { IntegrationConnectionAuthorizer } from '../../../../ports/integrations/integration-connection-authorizer.ts';
import type { ProjectStore } from '../../../../ports/persistence/project-store.ts';
import {
  defaultGitHubCommandRunner,
  parseGitHubRepositoryRemote,
  type GitHubCommandRunner,
} from '../../github/github-cli.ts';

const RawIssueSchema = z.looseObject({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['OPEN', 'CLOSED']),
  url: z.url(),
  labels: z.array(z.looseObject({ name: z.string() })),
  author: z.looseObject({ login: z.string().min(1) }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

type RawIssue = z.infer<typeof RawIssueSchema>;

export class WorkItemExecutionError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | 'work_item_unavailable'
      | 'work_item_conflict'
      | 'work_item_outcome_unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WorkItemExecutionError';
  }
}

const destination = {
  schemaVersion: 1 as const,
  adapterId: 'github_gh_cli_issues',
  provider: 'github',
  transport: 'process',
  dataBoundary: 'third_party' as const,
};

const maximumAuthority: CapabilityAuthority = {
  approval: 'always',
  projectContext: 'required',
  networkAccess: 'provider_api',
  dataClasses: ['owner_request', 'project_context', 'work_item_data'],
  sideEffects: ['third_party_disclosure', 'external_data_write'],
  credentials: 'server_managed',
};

function operationAuthority(
  arguments_: WorkItemActionArguments,
): CapabilityAuthority {
  const writes = ['create', 'comment', 'close', 'reopen'].includes(
    arguments_.action,
  );
  return {
    ...maximumAuthority,
    sideEffects: writes
      ? ['third_party_disclosure', 'external_data_write']
      : ['third_party_disclosure'],
  };
}

function marker(invocationId: string, kind: 'issue' | 'comment') {
  return `<!-- vera-${kind}-invocation:${invocationId} -->`;
}

function withoutMarker(value: string) {
  return value
    .replace(
      /\n?<!-- vera-(?:issue|comment)-invocation:invocation_[^\s]+ -->\s*$/u,
      '',
    )
    .trimEnd();
}

function parseIssues(value: string): RawIssue[] {
  try {
    return z.array(RawIssueSchema).parse(JSON.parse(value) as unknown);
  } catch {
    throw new WorkItemExecutionError(
      'GitHub returned an invalid issue response.',
      'work_item_unavailable',
    );
  }
}

function parseIssue(value: string): RawIssue {
  try {
    return RawIssueSchema.parse(JSON.parse(value) as unknown);
  } catch {
    throw new WorkItemExecutionError(
      'GitHub returned an invalid issue response.',
      'work_item_unavailable',
    );
  }
}

function issueResource(
  issue: RawIssue,
  repository: { owner: string; name: string },
) {
  return WorkItemSchema.parse({
    provider: 'github',
    repository,
    number: issue.number,
    title: issue.title,
    body: withoutMarker(issue.body),
    state: issue.state.toLowerCase(),
    url: issue.url,
    labels: issue.labels.map(({ name }) => name),
    author: issue.author?.login ?? 'unknown',
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  });
}

const issueFields =
  'number,title,body,state,url,labels,author,createdAt,updatedAt';

export class GitHubWorkItemActionExecutor
  implements IntegrationActionExecutor<WorkItemActionArguments, WorkItemResult>
{
  public readonly integrationId = 'github_gh_cli_issues';
  public readonly destination = destination;
  public readonly maximumAuthority = maximumAuthority;
  private readonly ghCommand: string;
  private readonly gitCommand: string;
  private readonly run: GitHubCommandRunner;

  public constructor(
    private readonly options: {
      projects: ProjectStore;
      connections: IntegrationConnectionAuthorizer;
      ghCommand?: string;
      gitCommand?: string;
      run?: GitHubCommandRunner;
    },
  ) {
    this.ghCommand = options.ghCommand ?? 'gh';
    this.gitCommand = options.gitCommand ?? 'git';
    this.run = options.run ?? defaultGitHubCommandRunner;
  }

  public authorityFor(arguments_: WorkItemActionArguments) {
    return operationAuthority(arguments_);
  }

  public async checkReadiness() {
    try {
      await Promise.all([
        this.run(this.ghCommand, ['--version']),
        this.run(this.gitCommand, ['--version']),
      ]);
    } catch (error) {
      throw new WorkItemExecutionError(
        'GitHub work items require Git and the GitHub CLI.',
        'work_item_unavailable',
        { cause: error },
      );
    }
  }

  public async execute(input: {
    principalId: string;
    invocationId: string;
    startedAt: string;
    recovery: boolean;
    arguments: WorkItemActionArguments;
    project?: { id: string; displayName: string };
    context?: import('../../../../domain/projects/project-context.ts').ProjectContextBundle;
  }): Promise<WorkItemResult> {
    const arguments_ = WorkItemActionArgumentsSchema.parse(input.arguments);
    const connection = await this.options.connections.requireActive(
      input.principalId,
      'github',
    );
    if (
      input.project === undefined ||
      input.context === undefined ||
      input.project.displayName !== arguments_.project.name ||
      input.context.manifest.projectId !== input.project.id
    ) {
      throw new WorkItemExecutionError(
        'The work-item invocation is missing its approved project context.',
        'work_item_conflict',
      );
    }
    const project = await this.options.projects.findProjectById(
      input.principalId,
      input.project.id,
    );
    if (project?.displayName !== input.project.displayName) {
      throw new WorkItemExecutionError(
        'The approved project is no longer registered.',
        'work_item_conflict',
      );
    }
    let repository: { owner: string; name: string };
    try {
      const remote = await this.run(
        this.gitCommand,
        ['remote', 'get-url', 'origin'],
        { cwd: project.source.rootPath },
      );
      repository = parseGitHubRepositoryRemote(remote.stdout);
    } catch (error) {
      throw new WorkItemExecutionError(
        'The registered project does not have one credential-free GitHub origin.',
        'work_item_conflict',
        { cause: error },
      );
    }
    const slug = `${repository.owner}/${repository.name}`;
    const approvedRepository = input.context.manifest.repository;
    if (
      approvedRepository?.provider !== 'github' ||
      approvedRepository.owner.toLowerCase() !==
        repository.owner.toLowerCase() ||
      approvedRepository.name.toLowerCase() !== repository.name.toLowerCase()
    ) {
      throw new WorkItemExecutionError(
        'The project GitHub origin differs from the repository frozen for approval.',
        'work_item_conflict',
      );
    }
    await this.assertConnectionAccount(connection.account.providerAccountId);
    await this.assertRepository(slug);

    let issues: RawIssue[];
    switch (arguments_.action) {
      case 'list': {
        issues = parseIssues(
          (
            await this.gh([
              'issue',
              'list',
              '--repo',
              slug,
              '--state',
              arguments_.state,
              '--limit',
              String(arguments_.limit),
              '--json',
              issueFields,
            ])
          ).stdout,
        );
        break;
      }
      case 'inspect': {
        issues = [await this.viewIssue(slug, arguments_.issue.number)];
        break;
      }
      case 'create': {
        const invocationMarker = marker(input.invocationId, 'issue');
        const existing = await this.findMarkedIssue(slug, invocationMarker);
        if (existing !== undefined) {
          if (
            existing.title !== arguments_.issue.title ||
            withoutMarker(existing.body) !== arguments_.issue.body.trimEnd()
          ) {
            throw new WorkItemExecutionError(
              'The recovered GitHub issue differs from the approved effect.',
              'work_item_conflict',
            );
          }
          issues = [existing];
          break;
        }
        if (input.recovery) {
          throw new WorkItemExecutionError(
            'Vera could not prove whether GitHub created the approved issue; review GitHub before retrying.',
            'work_item_outcome_unknown',
          );
        }
        const body = `${arguments_.issue.body.trimEnd()}${arguments_.issue.body.trim().length === 0 ? '' : '\n\n'}${invocationMarker}`;
        const result = await this.gh([
          'issue',
          'create',
          '--repo',
          slug,
          '--title',
          arguments_.issue.title,
          '--body',
          body,
          ...arguments_.issue.labels.flatMap((label) => ['--label', label]),
        ]);
        const number = Number(/\/(\d+)\s*$/u.exec(result.stdout.trim())?.[1]);
        if (!Number.isSafeInteger(number) || number <= 0) {
          throw new WorkItemExecutionError(
            'GitHub did not return the created issue identity.',
            'work_item_outcome_unknown',
          );
        }
        const created = await this.viewIssue(slug, number);
        if (!created.body.includes(invocationMarker)) {
          throw new WorkItemExecutionError(
            'GitHub did not preserve the issue idempotency marker.',
            'work_item_outcome_unknown',
          );
        }
        issues = [created];
        break;
      }
      case 'comment': {
        const current = await this.viewIssue(slug, arguments_.issue.number);
        const invocationMarker = marker(input.invocationId, 'comment');
        const comments = await this.issueComments(
          slug,
          arguments_.issue.number,
        );
        if (
          !comments.some((comment) => comment.body.includes(invocationMarker))
        ) {
          if (input.recovery) {
            throw new WorkItemExecutionError(
              'Vera could not prove whether GitHub created the approved comment; review GitHub before retrying.',
              'work_item_outcome_unknown',
            );
          }
          await this.gh([
            'issue',
            'comment',
            String(arguments_.issue.number),
            '--repo',
            slug,
            '--body',
            `${arguments_.body}\n\n${invocationMarker}`,
          ]);
        }
        issues = [current];
        break;
      }
      case 'close':
      case 'reopen': {
        const current = await this.viewIssue(slug, arguments_.issue.number);
        const desired = arguments_.action === 'close' ? 'CLOSED' : 'OPEN';
        if (current.state !== desired) {
          await this.gh([
            'issue',
            arguments_.action,
            String(arguments_.issue.number),
            '--repo',
            slug,
          ]);
        }
        const verified = await this.viewIssue(slug, arguments_.issue.number);
        if (verified.state !== desired) {
          throw new WorkItemExecutionError(
            'GitHub did not confirm the approved issue state.',
            'work_item_outcome_unknown',
          );
        }
        issues = [verified];
        break;
      }
    }

    const items = issues.map((issue) => issueResource(issue, repository));
    return WorkItemResultSchema.parse({
      schemaVersion: 1,
      action: arguments_.action,
      summary:
        arguments_.action === 'list'
          ? `Found ${String(items.length)} ${arguments_.state} GitHub issue${items.length === 1 ? '' : 's'} in ${slug}.`
          : `${arguments_.action === 'create' ? 'Created' : arguments_.action === 'inspect' ? 'Inspected' : arguments_.action === 'comment' ? 'Commented on' : arguments_.action === 'close' ? 'Closed' : 'Reopened'} GitHub issue #${String(items[0]?.number)} in ${slug}.`,
      connectionId: connection.id,
      items,
    });
  }

  private async gh(args: string[]) {
    try {
      return await this.run(this.ghCommand, args);
    } catch {
      throw new WorkItemExecutionError(
        'GitHub could not complete the approved work-item operation.',
        'work_item_unavailable',
      );
    }
  }

  private async assertConnectionAccount(providerAccountId: string) {
    const result = await this.gh(['api', 'user', '--jq', '.id']);
    if (result.stdout.trim() !== providerAccountId) {
      throw new WorkItemExecutionError(
        'The GitHub host session no longer matches the enabled connection.',
        'work_item_conflict',
      );
    }
  }

  private async assertRepository(slug: string) {
    const result = await this.gh([
      'repo',
      'view',
      slug,
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]);
    if (result.stdout.trim().toLowerCase() !== slug.toLowerCase()) {
      throw new WorkItemExecutionError(
        'The enabled GitHub account cannot verify the registered repository.',
        'work_item_conflict',
      );
    }
  }

  private async viewIssue(slug: string, number: number) {
    return parseIssue(
      (
        await this.gh([
          'issue',
          'view',
          String(number),
          '--repo',
          slug,
          '--json',
          issueFields,
        ])
      ).stdout,
    );
  }

  private async findMarkedIssue(slug: string, invocationMarker: string) {
    const issues = parseIssues(
      (
        await this.gh([
          'issue',
          'list',
          '--repo',
          slug,
          '--state',
          'all',
          '--limit',
          '100',
          '--search',
          invocationMarker,
          '--json',
          issueFields,
        ])
      ).stdout,
    );
    return issues.find((issue) => issue.body.includes(invocationMarker));
  }

  private async issueComments(slug: string, number: number) {
    const schema = z.object({
      comments: z.array(z.looseObject({ body: z.string() })),
    });
    const result = await this.gh([
      'issue',
      'view',
      String(number),
      '--repo',
      slug,
      '--json',
      'comments',
    ]);
    try {
      return schema.parse(JSON.parse(result.stdout) as unknown).comments;
    } catch (error) {
      throw new WorkItemExecutionError(
        'GitHub returned an invalid issue-comment response.',
        'work_item_unavailable',
        { cause: error },
      );
    }
  }
}
