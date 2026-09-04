import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ArtifactResource,
  ChangeApplicationResource,
  SoftwareChangePublicationResource,
  TaskResource,
} from '@vera/client';

import {
  isSafeGitHubPullRequestUrl,
  publicationDraftForArtifact,
  selectDeliveryApplication,
  selectDeliveryPublication,
  softwareChangeArtifactReference,
} from '../src/components/assistant/software-delivery/model.ts';

function application(
  id: string,
  status: ChangeApplicationResource['status'],
  createdAt: string,
): ChangeApplicationResource {
  return { id, status, createdAt } as ChangeApplicationResource;
}

function publication(
  id: string,
  status: SoftwareChangePublicationResource['status'],
  createdAt: string,
): SoftwareChangePublicationResource {
  return { id, status, createdAt } as SoftwareChangePublicationResource;
}

void describe('software delivery presentation', () => {
  void it('finds software changes produced directly or through a goal', () => {
    const direct = {
      output: {
        kind: 'software_change',
        artifact: { id: 'artifact_direct', type: 'software_change' },
      },
    } as TaskResource;
    const goal = {
      output: {
        kind: 'goal_result',
        artifacts: [
          { id: 'artifact_report', type: 'research_report' },
          { id: 'artifact_goal', type: 'software_change' },
        ],
      },
    } as TaskResource;

    assert.equal(
      softwareChangeArtifactReference(direct)?.id,
      'artifact_direct',
    );
    assert.equal(softwareChangeArtifactReference(goal)?.id, 'artifact_goal');
  });

  void it('resumes active attempts before completed or failed history', () => {
    assert.equal(
      selectDeliveryApplication([
        application('application_success', 'succeeded', '2026-08-27T12:00:00Z'),
        application('application_active', 'applying', '2026-08-27T11:00:00Z'),
        application('application_failed', 'failed', '2026-08-27T13:00:00Z'),
      ])?.id,
      'application_active',
    );
    assert.equal(
      selectDeliveryPublication([
        publication('publication_success', 'succeeded', '2026-08-27T12:00:00Z'),
        publication(
          'publication_review',
          'awaiting_approval',
          '2026-08-27T11:00:00Z',
        ),
      ])?.id,
      'publication_review',
    );
  });

  void it('keeps a successful staging attempt available after a later failed retry', () => {
    assert.equal(
      selectDeliveryApplication([
        application('application_success', 'succeeded', '2026-08-27T11:00:00Z'),
        application('application_failed', 'failed', '2026-08-27T12:00:00Z'),
      ])?.id,
      'application_success',
    );
  });

  void it('derives bounded, reviewable pull-request defaults from the artifact', () => {
    const artifact = {
      id: 'artifact_test',
      type: 'software_change',
      content: {
        objective: 'Add a durable delivery interface.',
        summary: 'Expose governed software delivery in Vera',
        ticket: { reference: 'VERA-UI', details: 'Make delivery tangible.' },
        files: [
          {
            relativePath: 'apps/frontend/src/app.tsx',
            operation: 'modify',
          },
        ],
        verification: [
          {
            command: 'npm test',
            status: 'passed',
            details: 'All tests passed.',
          },
        ],
        risks: [],
      },
    } as unknown as Extract<ArtifactResource, { type: 'software_change' }>;

    const draft = publicationDraftForArtifact(artifact);

    assert.equal(draft.baseBranch, 'main');
    assert.equal(draft.draft, true);
    assert.match(draft.pullRequestBody, /VERA-UI: Make delivery tangible\./u);
    assert.match(draft.pullRequestBody, /`npm test`/u);
  });

  void it('opens only canonical HTTPS GitHub pull-request URLs', () => {
    assert.equal(
      isSafeGitHubPullRequestUrl('https://github.com/4romgod/vera/pull/42'),
      true,
    );
    assert.equal(
      isSafeGitHubPullRequestUrl(
        'https://github.com/4romgod/vera/pull/42?redirect=unexpected',
      ),
      false,
    );
    assert.equal(
      isSafeGitHubPullRequestUrl(
        'https://github.com/4romgod/vera/pull/42#unexpected',
      ),
      false,
    );
    assert.equal(
      isSafeGitHubPullRequestUrl(
        'https://github.com.evil.test/4romgod/vera/pull/42',
      ),
      false,
    );
    assert.equal(isSafeGitHubPullRequestUrl('javascript:alert(1)'), false);
  });
});
