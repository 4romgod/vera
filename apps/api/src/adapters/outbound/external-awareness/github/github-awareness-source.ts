import { z } from 'zod';

import {
  ExternalSignalObservationSchema,
  type ExternalSignalObservation,
} from '../../../../domain/external-awareness/external-signal.ts';
import type { ExternalAwarenessSource } from '../../../../ports/external-awareness/external-awareness-source.ts';
import {
  defaultGitHubCommandRunner,
  type GitHubCommandRunner,
} from '../../github/github-cli.ts';

const GitHubNotificationSchema = z.looseObject({
  id: z.string().min(1),
  reason: z.enum([
    'assign',
    'author',
    'comment',
    'ci_activity',
    'invitation',
    'manual',
    'mention',
    'review_requested',
    'security_alert',
    'state_change',
    'subscribed',
    'team_mention',
  ]),
  updated_at: z.iso.datetime(),
  subject: z.looseObject({
    title: z.string().trim().min(1),
    url: z.url().nullable(),
    type: z.string().trim().min(1),
  }),
});

const PullRequestSchema = z.looseObject({
  number: z.number().int().positive(),
  title: z.string().trim().min(1),
  url: z.url(),
  updatedAt: z.iso.datetime(),
  statusCheckRollup: z.array(
    z.looseObject({
      name: z.string().optional(),
      context: z.string().optional(),
      conclusion: z.string().nullable().optional(),
      state: z.string().optional(),
    }),
  ),
});

const FAILURE_STATES = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'ERROR',
  'FAILURE',
  'TIMED_OUT',
]);

export class GitHubAwarenessSource implements ExternalAwarenessSource {
  public readonly integrationId = 'github';
  private readonly command: string;
  private readonly run: GitHubCommandRunner;

  public constructor(
    options: { command?: string; run?: GitHubCommandRunner } = {},
  ) {
    this.command = options.command ?? 'gh';
    this.run = options.run ?? defaultGitHubCommandRunner;
  }

  public async checkReadiness() {
    await this.run(this.command, ['--version']);
  }

  public async observe(
    input: Parameters<ExternalAwarenessSource['observe']>[0],
  ) {
    const slug = `${input.repository.owner}/${input.repository.name}`;
    await this.assertIdentity(input.account.providerAccountId, slug);
    const observations: ExternalSignalObservation[] = [];
    let complete = true;
    if (
      input.categories.some((category) =>
        ['review_requested', 'mentioned', 'assigned'].includes(category),
      )
    ) {
      const notifications = await this.json(
        [
          'api',
          '--method',
          'GET',
          `repos/${slug}/notifications`,
          '-f',
          'participating=true',
          '-f',
          'per_page=100',
        ],
        z.array(GitHubNotificationSchema),
        'GitHub returned invalid notification data.',
      );
      if (notifications.length === 100) complete = false;
      for (const notification of notifications) {
        const category = notificationCategory(notification.reason);
        if (category === undefined || !input.categories.includes(category))
          continue;
        observations.push(
          ExternalSignalObservationSchema.parse({
            externalKey: `notification:${notification.id}`,
            category,
            title: notification.subject.title,
            summary: notificationSummary(category, slug),
            url:
              webUrl(notification.subject.url, input.repository) ??
              `https://github.com/${slug}`,
            occurredAt: notification.updated_at,
          }),
        );
      }
    }
    if (input.categories.includes('failed_check')) {
      const pulls = await this.json(
        [
          'pr',
          'list',
          '--repo',
          slug,
          '--state',
          'open',
          '--limit',
          '200',
          '--json',
          'number,title,url,updatedAt,statusCheckRollup',
        ],
        z.array(PullRequestSchema),
        'GitHub returned invalid pull-request check data.',
      );
      if (pulls.length === 200) complete = false;
      for (const pull of pulls) {
        const failed = pull.statusCheckRollup.filter((check) =>
          FAILURE_STATES.has(
            (check.conclusion ?? check.state ?? '').toUpperCase(),
          ),
        );
        if (failed.length === 0) continue;
        const names = failed.map(
          (check) => check.name ?? check.context ?? 'unnamed check',
        );
        observations.push(
          ExternalSignalObservationSchema.parse({
            externalKey: `pull:${String(pull.number)}:failed-checks`,
            category: 'failed_check',
            title: `Checks failed on #${String(pull.number)}: ${pull.title}`,
            summary: `${String(failed.length)} failing ${failed.length === 1 ? 'check' : 'checks'} in ${slug}: ${names.join(', ')}.`,
            url: pull.url,
            occurredAt: pull.updatedAt,
          }),
        );
      }
    }
    return {
      observations: observations.sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          left.externalKey.localeCompare(right.externalKey),
      ),
      complete,
    };
  }

  private async assertIdentity(providerAccountId: string, slug: string) {
    const account = await this.json(
      ['api', 'user'],
      z.looseObject({ id: z.number().int().positive() }),
      'GitHub returned invalid account data.',
    );
    if (String(account.id) !== providerAccountId) {
      throw new Error(
        'The GitHub host session account differs from the account approved for this watch.',
      );
    }
    const repository = await this.json(
      ['repo', 'view', slug, '--json', 'nameWithOwner'],
      z.looseObject({ nameWithOwner: z.string().min(3) }),
      'GitHub returned invalid repository identity data.',
    );
    if (repository.nameWithOwner.toLowerCase() !== slug.toLowerCase()) {
      throw new Error('GitHub resolved a different repository identity.');
    }
  }

  private async json<T>(
    args: string[],
    schema: z.ZodType<T>,
    message: string,
  ): Promise<T> {
    let result;
    try {
      result = await this.run(this.command, args);
    } catch (error) {
      throw new Error(message, { cause: error });
    }
    try {
      return schema.parse(JSON.parse(result.stdout) as unknown);
    } catch (error) {
      throw new Error(message, { cause: error });
    }
  }
}

function notificationCategory(reason: string) {
  return reason === 'review_requested'
    ? ('review_requested' as const)
    : reason === 'mention' || reason === 'team_mention'
      ? ('mentioned' as const)
      : reason === 'assign'
        ? ('assigned' as const)
        : undefined;
}

function notificationSummary(
  category: 'review_requested' | 'mentioned' | 'assigned',
  slug: string,
) {
  return category === 'review_requested'
    ? `Your review was requested in ${slug}.`
    : category === 'mentioned'
      ? `You were mentioned in ${slug}.`
      : `Work in ${slug} was assigned to you.`;
}

function webUrl(
  apiUrl: string | null,
  repository: { owner: string; name: string },
) {
  if (apiUrl === null) return undefined;
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://api.github.com') return undefined;
  const prefix = `/repos/${repository.owner}/${repository.name}/`;
  if (!url.pathname.toLowerCase().startsWith(prefix.toLowerCase()))
    return undefined;
  const suffix = url.pathname.slice(prefix.length);
  const translated = suffix
    .replace(/^pulls\/(\d+)$/u, 'pull/$1')
    .replace(/^issues\/(\d+)$/u, 'issues/$1')
    .replace(/^actions\/runs\/(\d+)$/u, 'actions/runs/$1');
  return `https://github.com/${repository.owner}/${repository.name}/${translated}`;
}
