import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryDevelopmentCampaignStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-development-campaign-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createDevelopmentCampaignLifecycle } from '../../../src/application/development-campaigns/development-campaign-lifecycle.ts';
import type { SoftwareChangeApplicationLifecycle } from '../../../src/application/change-applications/software-change-application-lifecycle.ts';
import type { SoftwareChangePublicationLifecycle } from '../../../src/application/change-applications/software-change-publication-lifecycle.ts';
import type { TaskLifecycle } from '../../../src/application/tasks/task-lifecycle.ts';
import type { SoftwareChangeApplication } from '../../../src/domain/changes/software-change-application.ts';
import type { SoftwareChangePublication } from '../../../src/domain/changes/software-change-publication.ts';
import type { DevelopmentCampaignEffect } from '../../../src/domain/development-campaigns/development-campaign.ts';
import type { Project } from '../../../src/domain/projects/project.ts';
import type { TaskAggregate } from '../../../src/domain/tasks/task-aggregate.ts';
import type { CapabilityRuntimeRegistry } from '../../../src/ports/capabilities/capability-runtime.ts';
import type { DevelopmentCampaignOperations } from '../../../src/ports/development-campaigns/development-campaign-operations.ts';

const now = '2026-08-27T12:00:00.000Z';
const baseRevision = 'a'.repeat(40);
const headRevision = 'b'.repeat(40);
const mergeRevision = 'c'.repeat(40);
const softwareAuthority = {
  approval: 'always' as const,
  projectContext: 'required' as const,
  networkAccess: 'provider_api' as const,
  dataClasses: [
    'owner_request',
    'project_context',
    'artifact_content',
  ] as const,
  sideEffects: ['third_party_disclosure', 'isolated_workspace_write'] as const,
  credentials: 'server_managed' as const,
};
const destination = {
  schemaVersion: 1 as const,
  adapterId: 'codex_cli',
  provider: 'openai',
  transport: 'local_process',
  dataBoundary: 'third_party' as const,
};

function project(): Project {
  return {
    schemaVersion: 1,
    id: 'project_campaign',
    principalId: 'owner_v1',
    registrationKey: 'campaign-project',
    displayName: 'Vera',
    normalizedName: 'vera',
    source: { kind: 'local_git', rootPath: '/tmp/vera-campaign' },
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function requireValue<K, V>(values: Map<K, V>, key: K): V {
  const value = values.get(key);
  assert.ok(value);
  return value;
}

function task(
  attempt: number,
  status: TaskAggregate['run']['status'],
): TaskAggregate {
  const artifactId = `artifact_attempt_${String(attempt)}`;
  const approval =
    status === 'awaiting_approval'
      ? {
          id: `approval_task_${String(attempt)}`,
          status: 'pending' as const,
          reason: 'specialist_capability_invocation' as const,
          capability: { name: 'software_change' as const, version: 1 as const },
          proposedArguments: {
            objective: 'Add a visible status endpoint.',
            ticket: {
              reference: 'VERA-401',
              details: 'Add a visible status endpoint.',
            },
            project: { name: 'Vera' },
          },
          project: { id: 'project_campaign', displayName: 'Vera' },
          contextManifest: {
            schemaVersion: 1 as const,
            projectId: 'project_campaign',
            sourceKind: 'local_git' as const,
            revision: baseRevision,
            generatedAt: now,
            entries: [],
            totalFiles: 0,
            totalBytes: 0,
            limits: { maxFiles: 100, maxFileBytes: 1, maxTotalBytes: 1 },
            exclusions: [],
          },
          destination,
          authority: softwareAuthority,
          requestedAt: now,
        }
      : undefined;
  return {
    task: {
      id: `task_attempt_${String(attempt)}`,
      requestKey: `task-key-${String(attempt)}`,
      principalId: 'owner_v1',
      projectId: 'project_campaign',
      message: 'fixture',
      status: status === 'succeeded' ? 'completed' : 'active',
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: `run_attempt_${String(attempt)}`,
      status,
      createdAt: now,
      updatedAt: now,
      budget: {
        limits: {
          maxModelCalls: 1,
          maxCapabilityInvocations: 1,
          maxDurationMs: 1,
          maxArtifactBytes: 1,
          maxChangedFiles: 1,
          maxWebSearchCalls: 1,
        },
        consumed: {
          modelCalls: 0,
          capabilityInvocations: 0,
          artifactBytes: 0,
          webSearchCalls: 0,
        },
      },
      ...(approval === undefined ? {} : { approval }),
      ...(status === 'succeeded'
        ? {
            output: {
              kind: 'software_change' as const,
              change: {
                schemaVersion: 1 as const,
                project: {
                  id: 'project_campaign',
                  name: 'Vera',
                  revision: baseRevision,
                },
                ticket: {
                  reference: 'VERA-401',
                  details: 'Add a visible status endpoint.',
                },
                objective: 'Add a visible status endpoint.',
                summary: 'Fixture.',
                patch: 'fixture',
                files: [],
                verification: [],
                warnings: [],
              },
              artifact: {
                id: artifactId,
                version: 1 as const,
                type: 'software_change' as const,
                mediaType: 'application/vnd.vera.software-change+json' as const,
                sha256: 'd'.repeat(64),
                byteLength: 1,
              },
            },
          }
        : {}),
    },
    schemaVersion: 1,
    version: 1,
    events: [],
  } as unknown as TaskAggregate;
}

function application(
  attempt: number,
  protectedPath = false,
): SoftwareChangeApplication {
  const file = {
    relativePath: protectedPath
      ? 'apps/api/src/application/development-campaigns/authority.ts'
      : 'apps/api/src/status.ts',
    operation: 'create' as const,
    afterSha256: 'e'.repeat(64),
    bytes: 10,
  };
  return {
    schemaVersion: 1,
    version: 1,
    id: `application_attempt_${String(attempt)}`,
    requestKey: `application-key-${String(attempt)}`,
    principalId: 'owner_v1',
    status: 'awaiting_approval',
    sourceArtifact: {
      id: `artifact_attempt_${String(attempt)}`,
      sha256: 'd'.repeat(64),
    },
    project: { id: 'project_campaign', displayName: 'Vera' },
    approval: {
      id: `approval_application_${String(attempt)}`,
      status: 'pending',
      reason: 'software_change_application',
      sourceArtifact: {
        id: `artifact_attempt_${String(attempt)}`,
        sha256: 'd'.repeat(64),
      },
      project: { id: 'project_campaign', displayName: 'Vera' },
      effect: {
        adapterId: 'local_git_worktree',
        baseRevision,
        branchName: `vera/change-attempt-${String(attempt)}`,
        workspacePath: `/tmp/worktree-${String(attempt)}`,
        patchSha256: 'f'.repeat(64),
        staged: true,
        files: [file],
      },
      requestedAt: now,
    },
    effect: { id: `effect_application_${String(attempt)}`, status: 'pending' },
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

function publication(applicationId: string): SoftwareChangePublication {
  return {
    schemaVersion: 1,
    version: 1,
    id: 'publication_campaign',
    requestKey: 'publication-campaign',
    principalId: 'owner_v1',
    status: 'awaiting_approval',
    sourceApplication: {
      id: applicationId,
      effectId: 'effect_application',
      version: 1,
    },
    project: { id: 'project_campaign', displayName: 'Vera' },
    approval: {
      id: 'approval_publication',
      status: 'pending',
      reason: 'software_change_publication',
      effect: {
        adapterId: 'github_gh_cli',
        repository: { remoteName: 'origin', owner: 'owner', name: 'vera' },
        baseRevision,
        baseBranch: 'main',
        baseBranchRevision: baseRevision,
        headBranch: 'vera/change-campaign',
        workspacePath: '/tmp/worktree',
        treeRevision: '1'.repeat(40),
        files: [
          {
            relativePath: 'apps/api/src/status.ts',
            operation: 'create',
            afterSha256: 'e'.repeat(64),
            bytes: 10,
          },
        ],
        author: { name: 'Vera', email: 'vera@example.test' },
        commitMessage: 'feat: add status endpoint',
        pullRequest: {
          title: 'feat: add status endpoint',
          body: 'Campaign fixture',
          draft: false,
        },
        authority: {
          commit: 'create_one',
          push: 'create_or_verify_head',
          pullRequest: 'create_or_verify',
          directBasePush: false,
          forcePush: false,
        },
      },
      requestedAt: now,
    },
    effect: { id: 'effect_publication', status: 'pending' },
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function setup(
  options: {
    failFirstVerification?: boolean;
    protectedPath?: boolean;
    pendingRemoteChecks?: boolean;
    failedRemoteChecks?: boolean;
  } = {},
) {
  const resources = new InMemoryOwnerResourceStore();
  await resources.createProject(project());
  const store = new InMemoryDevelopmentCampaignStore();
  let taskAttempt = 0;
  const tasks = new Map<string, TaskAggregate>();
  const taskLifecycle = {
    submit() {
      taskAttempt += 1;
      const aggregate = task(taskAttempt, 'deciding');
      tasks.set(aggregate.task.id, aggregate);
      return Promise.resolve(aggregate);
    },
    getTask(_principalId: string, taskId: string) {
      return Promise.resolve(structuredClone(requireValue(tasks, taskId)));
    },
    progressTask(_principalId: string, taskId: string) {
      const attempt = Number(taskId.split('_').at(-1));
      const aggregate = task(attempt, 'awaiting_approval');
      tasks.set(taskId, aggregate);
      return Promise.resolve(structuredClone(aggregate));
    },
    decideApproval(input: { approvalId: string }) {
      const attempt = Number(input.approvalId.split('_').at(-1));
      const aggregate = task(attempt, 'succeeded');
      tasks.set(aggregate.task.id, aggregate);
      return Promise.resolve(structuredClone(aggregate));
    },
    cancelRun: () => Promise.resolve(task(1, 'cancelled')),
  } as unknown as TaskLifecycle;

  const applications = new Map<string, SoftwareChangeApplication>();
  const applicationLifecycle = {
    create(input: { artifactId: string }) {
      const attempt = Number(input.artifactId.split('_').at(-1));
      const value = application(attempt, options.protectedPath === true);
      applications.set(value.id, value);
      return Promise.resolve(structuredClone(value));
    },
    get(_principalId: string, id: string) {
      return Promise.resolve(structuredClone(requireValue(applications, id)));
    },
    decideApproval(input: { applicationId: string }) {
      const value = structuredClone(
        requireValue(applications, input.applicationId),
      );
      value.status = 'approved';
      value.approval.status = 'approved';
      applications.set(value.id, value);
      return Promise.resolve(structuredClone(value));
    },
    progress(_principalId: string, id: string) {
      const value = structuredClone(requireValue(applications, id));
      value.status = 'succeeded';
      value.effect.status = 'succeeded';
      value.result = {
        ...value.approval.effect,
        adapterId: 'local_git_worktree',
        appliedAt: now,
      };
      applications.set(value.id, value);
      return Promise.resolve(structuredClone(value));
    },
    cancel: () => Promise.resolve(application(1)),
  } as unknown as SoftwareChangeApplicationLifecycle;

  let publicationValue: SoftwareChangePublication | undefined;
  function requirePublication() {
    assert.ok(publicationValue);
    return publicationValue;
  }
  const publicationLifecycle = {
    create(input: { applicationId: string }) {
      publicationValue = publication(input.applicationId);
      return Promise.resolve(structuredClone(publicationValue));
    },
    get() {
      return Promise.resolve(structuredClone(requirePublication()));
    },
    decideApproval() {
      publicationValue = structuredClone(requirePublication());
      publicationValue.status = 'approved';
      publicationValue.approval.status = 'approved';
      return Promise.resolve(structuredClone(publicationValue));
    },
    progress() {
      publicationValue = structuredClone(requirePublication());
      publicationValue.status = 'succeeded';
      publicationValue.effect.status = 'succeeded';
      publicationValue.result = {
        adapterId: 'github_gh_cli',
        commitRevision: headRevision,
        remoteBranch: 'vera/change-campaign',
        pullRequest: {
          number: 44,
          url: 'https://github.com/owner/vera/pull/44',
          baseBranch: 'main',
          headBranch: 'vera/change-campaign',
          draft: false,
        },
        publishedAt: now,
      };
      return Promise.resolve(structuredClone(publicationValue));
    },
  } as unknown as SoftwareChangePublicationLifecycle;

  let verificationCalls = 0;
  let observationCalls = 0;
  const operations: DevelopmentCampaignOperations = {
    adapterId: 'local_git_github',
    listPolicies: () => [],
    prepare(input) {
      const effect: DevelopmentCampaignEffect = {
        adapterId: 'local_git_github',
        policyId: input.policyId,
        project: { id: 'project_campaign', displayName: 'Vera' },
        repository: { owner: 'owner', name: 'vera' },
        baseBranch: 'main',
        baseRevision,
        objective: input.objective,
        ticket: input.ticket,
        delivery: input.delivery,
        capabilities: input.capabilities,
        qualityGates: [
          {
            id: 'quality',
            label: 'Quality',
            executable: '/usr/bin/true',
            arguments: [],
            timeoutMs: 1_000,
          },
        ],
        protectedPathPrefixes: [
          'apps/api/src/application/development-campaigns/',
        ],
        limits: {
          maxAttempts: 2,
          maxChangedFiles: 20,
          maxChangedBytes: 10_000,
          maxDurationMinutes: 60,
          minimumRequiredChecks: 1,
        },
        merge: {
          method: 'squash',
          requireReviewApproval: false,
          synchronizeLocalBase: true,
        },
        authority: {
          implementation: 'bounded_capabilities',
          application: 'exact_generated_patch',
          verification: 'configured_commands',
          publication: 'create_one_pull_request',
          observation: 'github_checks_and_reviews',
          merge: 'policy_gated_exact_head',
          directBasePush: false,
          forcePush: false,
          policyMutation: false,
        },
      };
      return Promise.resolve(effect);
    },
    assertProjectBase: () => Promise.resolve(),
    verify() {
      verificationCalls += 1;
      const failed =
        options.failFirstVerification === true && verificationCalls === 1;
      return Promise.resolve({
        status: failed ? ('failed' as const) : ('passed' as const),
        checkedAt: now,
        gates: [
          {
            id: 'quality',
            label: 'Quality',
            status: failed ? ('failed' as const) : ('passed' as const),
            exitCode: failed ? 1 : 0,
            durationMs: 10,
            output: failed ? 'A bounded failure.' : '',
          },
        ],
      });
    },
    observe() {
      observationCalls += 1;
      const checkedAt = new Date(
        new Date(now).getTime() + observationCalls * 1_000,
      ).toISOString();
      return Promise.resolve({
        checkedAt,
        state: 'OPEN',
        headRevision,
        baseRevision,
        checks: options.failedRemoteChecks
          ? { total: 1, pending: 0, passed: 0, failed: 1 }
          : options.pendingRemoteChecks || observationCalls === 1
            ? { total: 1, pending: 1, passed: 0, failed: 0 }
            : { total: 1, pending: 0, passed: 1, failed: 0 },
        reviewDecision: 'NONE',
        mergeState: 'CLEAN',
      });
    },
    merge: () =>
      Promise.resolve({
        mergeRevision,
        baseRevision: mergeRevision,
        mergedAt: now,
      }),
    synchronize: () =>
      Promise.resolve({ baseRevision: mergeRevision, synchronizedAt: now }),
    checkReadiness: () => Promise.resolve(),
  };
  const capabilities = {
    selected(reference: { name: string }) {
      return reference.name === 'software_change'
        ? { destination, authority: softwareAuthority }
        : null;
    },
  } as unknown as CapabilityRuntimeRegistry;
  let id = 0;
  const lifecycle = createDevelopmentCampaignLifecycle({
    store,
    projects: resources,
    tasks: taskLifecycle,
    applications: applicationLifecycle,
    publications: publicationLifecycle,
    capabilities,
    operations,
    clock: () => now,
    createId: (prefix) => `${prefix}_fixture_${String(++id)}`,
  });
  return {
    lifecycle,
    verificationCalls: () => verificationCalls,
    observationCalls: () => observationCalls,
  };
}

async function createApproved(
  lifecycle: ReturnType<typeof createDevelopmentCampaignLifecycle>,
) {
  const created = await lifecycle.create({
    principalId: 'owner_v1',
    requestKey: 'campaign-request',
    projectId: 'project_campaign',
    policyId: 'vera-policy',
    objective: 'Add a visible status endpoint.',
    ticket: {
      reference: 'VERA-401',
      details: 'Add a visible status endpoint.',
    },
    delivery: {
      commitMessage: 'feat: add status endpoint',
      pullRequest: {
        title: 'feat: add status endpoint',
        body: 'Campaign fixture',
        draft: false,
      },
    },
  });
  return lifecycle.decideApproval({
    principalId: 'owner_v1',
    campaignId: created.id,
    decision: 'approved',
  });
}

async function runToTerminal(
  lifecycle: ReturnType<typeof createDevelopmentCampaignLifecycle>,
  campaignId: string,
) {
  let campaign = await lifecycle.get('owner_v1', campaignId);
  for (let count = 0; count < 30; count += 1) {
    if (
      [
        'succeeded',
        'failed',
        'review_required',
        'cancelled',
        'rejected',
      ].includes(campaign.status)
    )
      return campaign;
    campaign = await lifecycle.progress('owner_v1', campaignId);
  }
  throw new Error('Campaign did not settle.');
}

void describe('development campaign lifecycle', () => {
  void it('completes one approved implementation through verified merge and synchronization', async () => {
    const value = await setup();
    const approved = await createApproved(value.lifecycle);
    const completed = await runToTerminal(value.lifecycle, approved.id);

    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.attempts.length, 1);
    assert.equal(completed.attempts[0]?.verification?.status, 'passed');
    assert.equal(completed.pullRequest?.number, 44);
    assert.equal(completed.result?.mergeRevision, mergeRevision);
    assert.equal(completed.result.baseRevision, mergeRevision);
    assert.equal(completed.approval.effect.authority.directBasePush, false);
  });

  void it('retires a failed local attempt and produces one complete replacement', async () => {
    const value = await setup({ failFirstVerification: true });
    const approved = await createApproved(value.lifecycle);
    const completed = await runToTerminal(value.lifecycle, approved.id);

    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.attempts.length, 2);
    assert.equal(completed.attempts[0]?.verification?.status, 'failed');
    assert.equal(completed.attempts[1]?.verification?.status, 'passed');
    assert.equal(value.verificationCalls(), 2);
  });

  void it('fails closed before application when a patch changes campaign authority code', async () => {
    const value = await setup({ protectedPath: true });
    const approved = await createApproved(value.lifecycle);
    const completed = await runToTerminal(value.lifecycle, approved.id);

    assert.equal(completed.status, 'review_required');
    assert.equal(completed.failure?.code, 'review_required');
    assert.equal(completed.publicationId, undefined);
  });

  void it('settles at review_required when a remote check fails', async () => {
    const value = await setup({ failedRemoteChecks: true });
    const approved = await createApproved(value.lifecycle);
    const completed = await runToTerminal(value.lifecycle, approved.id);

    assert.equal(completed.status, 'review_required');
    assert.equal(completed.failure?.code, 'checks_failed');
    assert.equal(completed.pullRequest?.number, 44);
  });

  void it('does not persist or immediately repeat an unchanged pending observation', async () => {
    const value = await setup({ pendingRemoteChecks: true });
    const approved = await createApproved(value.lifecycle);
    let campaign = approved;
    for (let count = 0; campaign.status !== 'observing'; count += 1) {
      assert.ok(count < 20);
      campaign = await value.lifecycle.progress('owner_v1', campaign.id);
    }

    const first = await value.lifecycle.progress('owner_v1', campaign.id);
    const second = await value.lifecycle.progress('owner_v1', campaign.id);

    assert.equal(first.status, 'observing');
    assert.equal(second.version, first.version);
    assert.equal(value.observationCalls(), 2);
    assert.equal(
      second.events.filter(
        (event) => event.type === 'development_campaign_pull_request_observed',
      ).length,
      1,
    );
  });
});
