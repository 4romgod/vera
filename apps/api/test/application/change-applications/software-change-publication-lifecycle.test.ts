import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryChangeApplicationStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-change-application-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { InMemorySoftwareChangePublicationStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-software-change-publication-store.ts';
import { createSoftwareChangePublicationLifecycle } from '../../../src/application/change-applications/software-change-publication-lifecycle.ts';
import type { SoftwareChangeApplication } from '../../../src/domain/changes/software-change-application.ts';
import type { PublicationEffect } from '../../../src/domain/changes/software-change-publication.ts';
import type { Project } from '../../../src/domain/projects/project.ts';
import type { SoftwareChangePublicationExecutor } from '../../../src/ports/change-applications/software-change-publication-executor.ts';

const now = '2026-08-27T00:00:00.000Z';

function fixture() {
  const project: Project = {
    schemaVersion: 1,
    id: 'project_test',
    principalId: 'owner_v1',
    registrationKey: 'publication-test',
    displayName: 'Publication fixture',
    normalizedName: 'publication fixture',
    source: { kind: 'local_git', rootPath: '/tmp/publication-fixture' },
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const application: SoftwareChangeApplication = {
    schemaVersion: 1,
    version: 4,
    id: 'application_test',
    requestKey: 'application-key',
    principalId: 'owner_v1',
    status: 'succeeded',
    sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
    project: { id: project.id, displayName: project.displayName },
    approval: {
      id: 'approval_application',
      status: 'approved',
      reason: 'software_change_application',
      sourceArtifact: { id: 'artifact_test', sha256: 'a'.repeat(64) },
      project: { id: project.id, displayName: project.displayName },
      effect: {
        adapterId: 'local_git_worktree',
        baseRevision: 'a'.repeat(40),
        branchName: 'vera/change-test',
        workspacePath: '/tmp/publication-fixture-worktree',
        patchSha256: 'b'.repeat(64),
        staged: true,
        files: [
          {
            relativePath: 'README.md',
            operation: 'create',
            afterSha256: 'c'.repeat(64),
            bytes: 1,
          },
        ],
      },
      requestedAt: now,
      decidedAt: now,
      decidedBy: 'owner_v1',
    },
    effect: {
      id: 'effect_application',
      status: 'succeeded',
      startedAt: now,
      completedAt: now,
    },
    result: {
      adapterId: 'local_git_worktree',
      baseRevision: 'a'.repeat(40),
      branchName: 'vera/change-test',
      workspacePath: '/tmp/publication-fixture-worktree',
      patchSha256: 'b'.repeat(64),
      staged: true,
      files: [
        {
          relativePath: 'README.md',
          operation: 'create',
          afterSha256: 'c'.repeat(64),
          bytes: 1,
        },
      ],
      appliedAt: now,
    },
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  const applicationResult = application.result;
  assert.ok(applicationResult);
  const effect: PublicationEffect = {
    adapterId: 'github_gh_cli',
    repository: { remoteName: 'origin', owner: 'owner', name: 'fixture' },
    baseRevision: 'a'.repeat(40),
    baseBranch: 'main',
    baseBranchRevision: 'a'.repeat(40),
    headBranch: 'vera/change-test',
    workspacePath: '/tmp/publication-fixture-worktree',
    treeRevision: 'd'.repeat(40),
    files: structuredClone(applicationResult.files),
    author: { name: 'Vera Test', email: 'vera@example.test' },
    commitMessage: 'Publish fixture',
    pullRequest: {
      title: 'Publish fixture',
      body: 'Fixture body',
      draft: true,
    },
    authority: {
      commit: 'create_one',
      push: 'create_or_verify_head',
      pullRequest: 'create_or_verify',
      directBasePush: false,
      forcePush: false,
    },
  };
  return { project, application, effect };
}

async function setup() {
  const value = fixture();
  const applications = new InMemoryChangeApplicationStore();
  const publications = new InMemorySoftwareChangePublicationStore();
  const resources = new InMemoryOwnerResourceStore();
  await applications.create(value.application);
  await resources.createProject(value.project);
  let executions = 0;
  const executor: SoftwareChangePublicationExecutor = {
    adapterId: 'github_gh_cli',
    prepare: () => Promise.resolve(structuredClone(value.effect)),
    execute: () => {
      executions += 1;
      return Promise.resolve({
        adapterId: 'github_gh_cli',
        commitRevision: 'e'.repeat(40),
        remoteBranch: value.effect.headBranch,
        pullRequest: {
          number: 42,
          url: 'https://github.com/owner/fixture/pull/42',
          baseBranch: 'main',
          headBranch: value.effect.headBranch,
          draft: true,
        },
        publishedAt: now,
      });
    },
    checkReadiness: () => Promise.resolve(),
  };
  let id = 0;
  const lifecycle = createSoftwareChangePublicationLifecycle({
    store: publications,
    applications,
    projects: resources,
    executor,
    clock: () => now,
    createId: (prefix) => `${prefix}_test_${String(++id)}`,
  });
  return { ...value, lifecycle, executions: () => executions };
}

void describe('software-change publication lifecycle', () => {
  void it('requires separate approval and publishes a frozen effect exactly once', async () => {
    const value = await setup();
    const created = await value.lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'publication-request',
      applicationId: value.application.id,
      baseBranch: 'main',
      commitMessage: 'Publish fixture',
      pullRequest: {
        title: 'Publish fixture',
        body: 'Fixture body',
        draft: true,
      },
    });
    assert.equal(created.status, 'awaiting_approval');
    assert.equal(created.approval.effect.authority.directBasePush, false);
    const approved = await value.lifecycle.decideApproval({
      principalId: 'owner_v1',
      publicationId: created.id,
      decision: 'approved',
    });
    assert.equal(approved.status, 'approved');

    const completed = await value.lifecycle.progress('owner_v1', created.id);
    const unchanged = await value.lifecycle.progress('owner_v1', created.id);

    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result?.pullRequest.number, 42);
    assert.equal(unchanged.version, completed.version);
    assert.equal(value.executions(), 1);
  });

  void it('rejects reuse of an idempotency key for different PR metadata', async () => {
    const value = await setup();
    await value.lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'publication-reused',
      applicationId: value.application.id,
      baseBranch: 'main',
      commitMessage: 'Publish fixture',
      pullRequest: {
        title: 'Publish fixture',
        body: 'Fixture body',
        draft: true,
      },
    });
    await assert.rejects(
      value.lifecycle.create({
        principalId: 'owner_v1',
        requestKey: 'publication-reused',
        applicationId: value.application.id,
        baseBranch: 'main',
        commitMessage: 'Publish fixture',
        pullRequest: {
          title: 'Changed title',
          body: 'Fixture body',
          draft: true,
        },
      }),
      { code: 'software_change_publication_idempotency_key_reused' },
    );
  });
});
