import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { InMemoryChangeApplicationStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-change-application-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createSoftwareChangeApplicationLifecycle } from '../../../src/application/change-applications/software-change-application-lifecycle.ts';
import type { Artifact } from '../../../src/domain/artifacts/artifact.ts';
import type { Project } from '../../../src/domain/projects/project.ts';
import type {
  PreparedChangeApplication,
  SoftwareChangeApplicationExecutor,
} from '../../../src/ports/change-applications/software-change-application-executor.ts';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const project: Project = {
    schemaVersion: 1,
    id: 'project_test',
    principalId: 'owner_v1',
    registrationKey: 'project-test',
    displayName: 'Fixture',
    normalizedName: 'fixture',
    source: { kind: 'local_git', rootPath: '/tmp/fixture' },
    status: 'active',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  };
  const content = {
    schemaVersion: 1 as const,
    project: {
      id: project.id,
      name: project.displayName,
      revision: 'a'.repeat(40),
    },
    ticket: { reference: 'TEST-1', details: 'Create one file.' },
    objective: 'Create one file.',
    summary: 'Created one file.',
    files: [
      {
        relativePath: 'created.txt',
        operation: 'create' as const,
        afterSha256: sha256('created\n'),
        bytes: 8,
      },
    ],
    patch: 'test patch',
    verification: [],
    risks: [],
  };
  const artifact: Extract<Artifact, { type: 'software_change' }> = {
    schemaVersion: 1,
    id: 'artifact_test',
    version: 1,
    principalId: 'owner_v1',
    taskId: 'task_test',
    runId: 'run_test',
    invocationId: 'invocation_test',
    projectId: project.id,
    type: 'software_change',
    mediaType: 'application/vnd.vera.software-change+json',
    sha256: sha256(JSON.stringify(content)),
    byteLength: Buffer.byteLength(JSON.stringify(content)),
    producer: { provider: 'test', model: 'test', durationMs: 1 },
    content,
    createdAt: '2026-08-25T00:00:00.000Z',
  };
  const prepared: PreparedChangeApplication = {
    adapterId: 'local_git_worktree',
    baseRevision: content.project.revision,
    branchName: 'vera/change-test',
    workspacePath: '/tmp/vera-applications/application_test',
    patchSha256: sha256(content.patch),
    staged: true,
    files: content.files,
  };
  return { project, artifact, prepared };
}

async function setup(reconciliation: 'succeeded' | 'cancelled') {
  const { project, artifact, prepared } = fixture();
  const resources = new InMemoryOwnerResourceStore();
  const store = new InMemoryChangeApplicationStore();
  await resources.createProject(project);
  await resources.createArtifact(artifact);
  const executor: SoftwareChangeApplicationExecutor = {
    adapterId: 'local_git_worktree',
    prepare: () => Promise.resolve(structuredClone(prepared)),
    execute: () => Promise.reject(new Error('execute was not expected')),
    reconcileCancellation: () =>
      Promise.resolve(
        reconciliation === 'succeeded'
          ? {
              outcome: 'succeeded' as const,
              result: {
                ...structuredClone(prepared),
                appliedAt: '2026-08-25T00:00:10.000Z',
              },
            }
          : { outcome: 'cancelled' as const },
      ),
    checkReadiness: () => Promise.resolve(),
  };
  let nextId = 0;
  const lifecycle = createSoftwareChangeApplicationLifecycle({
    store,
    resources,
    executor,
    clock: () => '2026-08-25T00:00:10.000Z',
    createId: (prefix) => `${prefix}_test_${String((nextId += 1))}`,
  });
  return { store, lifecycle, artifact };
}

void describe('software-change application lifecycle', () => {
  void it('keeps a rejected, never-started effect distinct from a failure', async () => {
    const { lifecycle, artifact } = await setup('cancelled');
    const created = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'reject-application',
      artifactId: artifact.id,
    });
    const rejected = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      applicationId: created.id,
      decision: 'rejected',
    });

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.effect.status, 'pending');
    assert.equal(rejected.failure, undefined);
  });

  void it('marks a pre-execution cancellation as an unperformed effect', async () => {
    const { lifecycle, artifact } = await setup('cancelled');
    const created = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'cancel-application',
      artifactId: artifact.id,
    });
    const cancelled = await lifecycle.cancel({
      principalId: 'owner_v1',
      applicationId: created.id,
    });

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.effect.status, 'cancelled');
    assert.equal(cancelled.failure?.code, 'cancelled');
  });

  void it('records success when restart reconciliation finds the exact effect after cancellation', async () => {
    const { store, lifecycle, artifact } = await setup('succeeded');
    const created = await lifecycle.create({
      principalId: 'owner_v1',
      requestKey: 'reconcile-application',
      artifactId: artifact.id,
    });
    const approved = await lifecycle.decideApproval({
      principalId: 'owner_v1',
      applicationId: created.id,
      decision: 'approved',
    });
    const interrupted = structuredClone(approved);
    interrupted.version += 1;
    interrupted.status = 'cancellation_requested';
    interrupted.effect.status = 'executing';
    interrupted.effect.startedAt = '2026-08-25T00:00:05.000Z';
    assert.equal(await store.replace(interrupted, approved.version), true);

    const reconciled = await lifecycle.progress('owner_v1', created.id);

    assert.equal(reconciled.status, 'succeeded');
    assert.equal(reconciled.effect.status, 'succeeded');
    assert.ok(reconciled.result);
    assert.equal(reconciled.failure, undefined);
    assert.equal(
      reconciled.events.at(-1)?.data.reconciledAfterCancellation,
      true,
    );
  });
});
