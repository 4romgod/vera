import type {
  ArtifactReference,
  ArtifactResource,
  ChangeApplicationResource,
  SoftwareChangePublicationResource,
  TaskResource,
} from '@vera/client';

export type PublicationDraft = {
  baseBranch: string;
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
  draft: boolean;
};

export function softwareChangeArtifactReference(
  task: TaskResource,
): Extract<ArtifactReference, { type: 'software_change' }> | undefined {
  const output = task.output;
  if (output === undefined) return undefined;
  if (output.kind === 'software_change') return output.artifact;
  if (output.kind === 'goal_result') {
    return output.artifacts.find(
      (
        artifact,
      ): artifact is Extract<ArtifactReference, { type: 'software_change' }> =>
        artifact.type === 'software_change',
    );
  }
  if (output.kind === 'adaptive_goal_result') {
    return output.artifacts.find(
      (
        artifact,
      ): artifact is Extract<ArtifactReference, { type: 'software_change' }> =>
        artifact.type === 'software_change',
    );
  }
  return undefined;
}

function newest<T extends { id: string; createdAt: string }>(
  values: T[],
): T | undefined {
  return [...values].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  )[0];
}

export function selectDeliveryApplication(
  applications: ChangeApplicationResource[],
): ChangeApplicationResource | undefined {
  return (
    newest(
      applications.filter((application) =>
        [
          'awaiting_approval',
          'approved',
          'applying',
          'cancellation_requested',
        ].includes(application.status),
      ),
    ) ??
    newest(
      applications.filter((application) => application.status === 'succeeded'),
    ) ??
    newest(applications)
  );
}

export function selectDeliveryPublication(
  publications: SoftwareChangePublicationResource[],
): SoftwareChangePublicationResource | undefined {
  return (
    newest(
      publications.filter((publication) =>
        ['awaiting_approval', 'approved', 'publishing'].includes(
          publication.status,
        ),
      ),
    ) ??
    newest(
      publications.filter((publication) => publication.status === 'succeeded'),
    ) ??
    newest(publications)
  );
}

function boundedTitle(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

export function publicationDraftForArtifact(
  artifact: Extract<ArtifactResource, { type: 'software_change' }>,
): PublicationDraft {
  const change = artifact.content;
  const title = boundedTitle(change.summary || change.objective, 256);
  const files = change.files
    .map((file) => `- ${file.operation}: \`${file.relativePath}\``)
    .join('\n');
  const verification = change.verification
    .map(
      (check) => `- ${check.status}: \`${check.command}\` — ${check.details}`,
    )
    .join('\n');
  const risks =
    change.risks.length === 0
      ? '- None identified by the specialist.'
      : change.risks.map((risk) => `- ${risk}`).join('\n');
  return {
    baseBranch: 'main',
    commitMessage: boundedTitle(title, 200),
    pullRequestTitle: title,
    pullRequestBody: [
      '## Objective',
      '',
      change.objective,
      '',
      '## Source request',
      '',
      `${change.ticket.reference}: ${change.ticket.details}`,
      '',
      '## Changed files',
      '',
      files,
      '',
      '## Verification',
      '',
      verification || '- No verification was reported.',
      '',
      '## Risks',
      '',
      risks,
    ].join('\n'),
    draft: true,
  };
}

export function isSafeGitHubPullRequestUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'github.com' &&
      /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/u.test(url.pathname) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}
