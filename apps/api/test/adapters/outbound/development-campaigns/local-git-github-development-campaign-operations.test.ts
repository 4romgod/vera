import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LocalGitGitHubDevelopmentCampaignOperations } from '../../../../src/adapters/outbound/development-campaigns/local-git-github-development-campaign-operations.ts';
import type { SoftwareChangeApplication } from '../../../../src/domain/changes/software-change-application.ts';
import type { DevelopmentCampaign } from '../../../../src/domain/development-campaigns/development-campaign.ts';
import type { Project } from '../../../../src/domain/projects/project.ts';

const now = '2026-08-27T12:00:00.000Z';
const revision = 'a'.repeat(40);
const root = '/tmp/vera-campaign-operations';
const project: Project = {
  schemaVersion: 1,
  id: 'project_operations',
  principalId: 'owner_v1',
  registrationKey: 'operations',
  displayName: 'Vera',
  normalizedName: 'vera',
  source: { kind: 'local_git', rootPath: root },
  status: 'active',
  createdAt: now,
  updatedAt: now,
};

function operations(options?: {
  dirty?: boolean;
  gateExitCode?: number;
  gateOutput?: string;
}) {
  const commands: { command: string; arguments: string[]; cwd?: string }[] = [];
  const instance = new LocalGitGitHubDevelopmentCampaignOperations({
    catalog: {
      schemaVersion: 1,
      policies: [
        {
          id: 'fixture',
          projectRoot: root,
          baseBranch: 'main',
          qualityGates: [
            {
              id: 'quality',
              label: 'Quality',
              executable: '/usr/bin/true',
              arguments: [],
              timeoutMs: 1_000,
            },
          ],
          protectedPathPrefixes: ['private/'],
          limits: {
            maxAttempts: 2,
            maxChangedFiles: 10,
            maxChangedBytes: 10_000,
            maxDurationMinutes: 60,
            minimumRequiredChecks: 1,
          },
          merge: {
            enabled: true,
            method: 'squash',
            requireReviewApproval: false,
            synchronizeLocalBase: true,
          },
        },
      ],
    },
    clock: () => now,
    run: (command, arguments_, commandOptions) => {
      commands.push({
        command,
        arguments: arguments_,
        ...(commandOptions?.cwd === undefined
          ? {}
          : { cwd: commandOptions.cwd }),
      });
      if (command === '/usr/bin/true') {
        return Promise.resolve({
          stdout:
            options?.gateOutput ??
            (options?.gateExitCode === 0 ? 'green' : 'failed output'),
          stderr: '',
          exitCode: options?.gateExitCode ?? 0,
        });
      }
      const gitArguments = arguments_.slice(2);
      const key = gitArguments.join(' ');
      const stdout =
        key === 'branch --show-current'
          ? 'main\n'
          : key === 'rev-parse HEAD'
            ? `${revision}\n`
            : key === 'remote get-url origin'
              ? 'git@github.com:4romgod/vera.git\n'
              : key === 'status --porcelain=v1 --untracked-files=all'
                ? options?.dirty === true
                  ? ' M README.md\n'
                  : ''
                : key === 'ls-remote --heads origin refs/heads/main'
                  ? `${revision}\trefs/heads/main\n`
                  : '';
      return Promise.resolve({ stdout, stderr: '', exitCode: 0 });
    },
  });
  return { instance, commands };
}

async function preparedEffect() {
  return operations().instance.prepare({
    project,
    policyId: 'fixture',
    objective: 'Add one status endpoint.',
    ticket: { reference: 'VERA-401', details: 'Add one status endpoint.' },
    delivery: {
      commitMessage: 'feat: add status endpoint',
      pullRequest: {
        title: 'feat: add status endpoint',
        body: 'Body',
        draft: false,
      },
    },
    capabilities: [
      {
        name: 'software_change',
        version: 1,
        destination: {
          schemaVersion: 1,
          adapterId: 'codex_cli',
          provider: 'openai',
          transport: 'local_process',
          dataBoundary: 'third_party',
        },
        authority: {
          approval: 'always',
          projectContext: 'required',
          networkAccess: 'provider_api',
          dataClasses: ['owner_request', 'project_context', 'artifact_content'],
          sideEffects: ['third_party_disclosure', 'isolated_workspace_write'],
          credentials: 'server_managed',
        },
      },
    ],
  });
}

void describe('local Git and GitHub development-campaign operations', () => {
  void it('freezes a clean synchronized base and built-in authority paths', async () => {
    const effect = await preparedEffect();

    assert.equal(effect.baseRevision, revision);
    assert.deepEqual(effect.repository, { owner: '4romgod', name: 'vera' });
    assert.ok(effect.protectedPathPrefixes.includes('.github/'));
    assert.ok(effect.protectedPathPrefixes.includes('apps/api/src/bootstrap/'));
    assert.ok(effect.protectedPathPrefixes.includes('private/'));
  });

  void it('refuses to create authority from a dirty base checkout', async () => {
    await assert.rejects(
      operations({ dirty: true }).instance.prepare({
        project,
        policyId: 'fixture',
        objective: 'Objective',
        ticket: { reference: 'VERA-1', details: 'Details' },
        delivery: {
          commitMessage: 'feat: objective',
          pullRequest: { title: 'feat: objective', body: '', draft: false },
        },
        capabilities: [],
      }),
      { code: 'campaign_conflict' },
    );
  });

  void it('executes exact configured gates in the managed workspace', async () => {
    const effect = await preparedEffect();
    const value = operations({ gateExitCode: 0 });
    const application = {
      status: 'succeeded',
      project: { id: project.id, displayName: project.displayName },
      result: {
        baseRevision: revision,
        workspacePath: '/tmp/managed-campaign-worktree',
        files: [{ relativePath: 'apps/api/src/status.ts', bytes: 12 }],
      },
    } as unknown as SoftwareChangeApplication;
    const campaign = {
      approval: { effect },
      attempts: [],
    } as unknown as DevelopmentCampaign;

    const verification = await value.instance.verify({ campaign, application });

    assert.equal(verification.status, 'passed');
    assert.ok(
      value.commands.some(
        (command) =>
          command.command === '/usr/bin/true' &&
          command.cwd === '/tmp/managed-campaign-worktree',
      ),
    );
  });

  void it('fails closed before invoking gates for protected-path changes', async () => {
    const effect = await preparedEffect();
    const value = operations();
    const application = {
      status: 'succeeded',
      project: { id: project.id, displayName: project.displayName },
      result: {
        baseRevision: revision,
        workspacePath: '/tmp/managed-campaign-worktree',
        files: [{ relativePath: '.env.ollama', bytes: 12 }],
      },
    } as unknown as SoftwareChangeApplication;
    const campaign = {
      approval: { effect },
      attempts: [],
    } as unknown as DevelopmentCampaign;

    await assert.rejects(value.instance.verify({ campaign, application }), {
      code: 'review_required',
    });
    assert.equal(
      value.commands.some((command) => command.command === '/usr/bin/true'),
      false,
    );
  });

  void it('bounds persisted gate output to the domain limit', async () => {
    const effect = await preparedEffect();
    const value = operations({
      gateExitCode: 1,
      gateOutput: 'x'.repeat(20_000),
    });
    const application = {
      status: 'succeeded',
      project: { id: project.id, displayName: project.displayName },
      result: {
        baseRevision: revision,
        workspacePath: '/tmp/managed-campaign-worktree',
        files: [{ relativePath: 'apps/api/src/status.ts', bytes: 12 }],
      },
    } as unknown as SoftwareChangeApplication;
    const campaign = {
      approval: { effect },
      attempts: [],
    } as unknown as DevelopmentCampaign;

    const verification = await value.instance.verify({ campaign, application });

    assert.equal(verification.status, 'failed');
    assert.ok(Buffer.byteLength(verification.gates[0]?.output ?? '') <= 8_000);
    assert.match(
      verification.gates[0]?.output ?? '',
      /^\[earlier output omitted\]/u,
    );
  });
});
