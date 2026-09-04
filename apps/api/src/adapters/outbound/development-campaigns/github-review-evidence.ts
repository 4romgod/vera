import { z } from 'zod';

import type { PullRequestObservation } from '../../../domain/development-campaigns/development-campaign.ts';

type CommandResult = { stdout: string; stderr: string; exitCode: number };
type Runner = (
  command: string,
  arguments_: string[],
  options?: { allowFailure?: boolean },
) => Promise<CommandResult>;

export function boundedEvidenceText(value: unknown, limit = 4_000) {
  if (typeof value !== 'string') return undefined;
  const normalized = Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code < 32 && !['\n', '\r', '\t'].includes(character)) ||
        code === 127
        ? ' '
        : character;
    })
    .join('')
    .trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, limit);
}

export async function readGitHubReviewEvidence(input: {
  run: Runner;
  ghCommand: string;
  repositorySlug: string;
  pullRequest: { number: number; headRefOid: string };
}): Promise<{
  failedChecks: NonNullable<PullRequestObservation['failedChecks']>;
  reviewFeedback: NonNullable<PullRequestObservation['reviewFeedback']>;
}> {
  const [checksResponse, commentsResponse] = await Promise.all([
    input.run(
      input.ghCommand,
      [
        'api',
        `repos/${input.repositorySlug}/commits/${input.pullRequest.headRefOid}/check-runs?per_page=100`,
      ],
      { allowFailure: true },
    ),
    input.run(
      input.ghCommand,
      [
        'api',
        `repos/${input.repositorySlug}/pulls/${String(input.pullRequest.number)}/comments?per_page=100`,
      ],
      { allowFailure: true },
    ),
  ]);
  const failedChecks: NonNullable<PullRequestObservation['failedChecks']> = [];
  const reviewFeedback: NonNullable<PullRequestObservation['reviewFeedback']> =
    [];
  try {
    const parsed = z
      .object({
        check_runs: z.array(
          z
            .object({
              name: z.string(),
              status: z.string(),
              conclusion: z.string().nullable().optional(),
              details_url: z.string().optional(),
              output: z
                .object({
                  title: z.string().nullable().optional(),
                  summary: z.string().nullable().optional(),
                  text: z.string().nullable().optional(),
                })
                .loose()
                .optional(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(JSON.parse(checksResponse.stdout));
    for (const check of parsed.check_runs) {
      if (
        check.status.toUpperCase() !== 'COMPLETED' ||
        ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(
          check.conclusion?.toUpperCase() ?? '',
        )
      )
        continue;
      const summary = boundedEvidenceText(
        [check.output?.title, check.output?.summary, check.output?.text]
          .filter((value): value is string => typeof value === 'string')
          .join('\n'),
      );
      failedChecks.push({
        name: check.name.slice(0, 300),
        status: check.status.slice(0, 100),
        conclusion: (check.conclusion ?? 'FAILED').slice(0, 100),
        ...(check.details_url?.startsWith('https://') === true
          ? { detailsUrl: check.details_url }
          : {}),
        ...(summary === undefined ? {} : { summary }),
      });
    }
  } catch {
    // Enrichment is best-effort; the rollup remains the source of state.
  }
  try {
    const comments = z
      .array(
        z
          .object({
            user: z.object({ login: z.string() }).loose().nullable().optional(),
            body: z.string().optional(),
            html_url: z.string().optional(),
            path: z.string().optional(),
            line: z.number().int().positive().nullable().optional(),
            original_line: z.number().int().positive().nullable().optional(),
          })
          .loose(),
      )
      .parse(JSON.parse(commentsResponse.stdout));
    for (const comment of comments) {
      const body = boundedEvidenceText(comment.body);
      if (body === undefined) continue;
      const line = comment.line ?? comment.original_line ?? undefined;
      reviewFeedback.push({
        kind: 'inline_comment',
        author: comment.user?.login ?? 'unknown',
        body,
        ...(comment.html_url?.startsWith('https://') === true
          ? { url: comment.html_url }
          : {}),
        ...(comment.path === undefined
          ? {}
          : { path: comment.path.slice(0, 1_000) }),
        ...(line === undefined ? {} : { line }),
      });
    }
  } catch {
    // Review state is still available when comment enrichment is unavailable.
  }
  return {
    failedChecks: failedChecks.slice(0, 20),
    reviewFeedback: reviewFeedback.slice(0, 50),
  };
}
