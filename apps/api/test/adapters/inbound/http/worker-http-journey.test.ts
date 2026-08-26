import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

import type { AppConfig } from '../../../../src/bootstrap/config.ts';
import { createApp } from '../../../../src/bootstrap/wiring.ts';

const executeFile = promisify(execFile);
const cleanups: (() => Promise<void>)[] = [];

function config(workspacesRoot = '/tmp/vera-test-applications'): AppConfig {
  return {
    host: '127.0.0.1',
    port: 4310,
    model: { provider: 'deterministic', model: 'deterministic-v1' },
    conversationContext: { maxMessages: 20, maxCharacters: 40_000 },
    storage: {
      mode: 'memory',
      mongodbUri: 'mongodb://127.0.0.1:27017',
      mongodbDatabase: 'unused',
      redisUrl: 'redis://127.0.0.1:6379',
      scratchpadTtlSeconds: 60,
      dependencyTimeoutMs: 250,
    },
    planning: {
      adapterId: 'structured_model',
      adapters: { codexCli: { command: 'codex' } },
    },
    change: {
      adapterId: 'deterministic_change',
      adapters: { codexCli: { command: 'codex' } },
    },
    research: { adapterId: 'disabled' },
    application: { workspacesRoot },
    worker: { concurrency: 2, pollIntervalMs: 25, leaseMs: 900_000 },
  };
}

async function waitForApplication(
  app: ReturnType<typeof createApp>,
  applicationId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/change-applications/${applicationId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      id: string;
      status: string;
      result?: { workspacePath: string; branchName: string };
    }>();
    if (body.status === status) return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `Change application ${applicationId} did not reach ${status}.`,
  );
}

async function waitForRun(
  app: ReturnType<typeof createApp>,
  runId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      runStatus: string;
      approval?: {
        id: string;
        status: string;
        proposedArguments: Record<string, unknown>;
      };
      output?: {
        kind: string;
        artifact?: { id: string };
        artifacts?: { id: string }[];
      };
      goal?: {
        status: string;
        currentStepIndex: number;
        steps: { status: string; artifact?: { id: string } }[];
      };
    }>();
    if (body.runStatus === status) return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach ${status}.`);
}

async function waitForNextApproval(
  app: ReturnType<typeof createApp>,
  runId: string,
  previousApprovalId: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      runStatus: string;
      approval?: {
        id: string;
        capability: { name: string };
        inputArtifacts?: { id: string; type: string }[];
        authority?: { dataClasses: string[] };
      };
      goal?: { currentStepIndex: number };
    }>();
    if (
      body.runStatus === 'awaiting_approval' &&
      body.approval !== undefined &&
      body.approval.id !== previousApprovalId
    ) {
      return body;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach its next approval.`);
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => cleanup()));
});

void describe('production worker HTTP journey', () => {
  void it('returns durable commands before background decision and execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-worker-http-'));
    await executeFile('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# Worker fixture\n', 'utf8');
    await executeFile('git', ['add', 'README.md'], { cwd: root });
    await executeFile(
      'git',
      [
        '-c',
        'user.name=Vera Test',
        '-c',
        'user.email=vera@example.test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const app = createApp(config());
    cleanups.push(
      async () => app.close(),
      async () => rm(root, { recursive: true }),
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { 'idempotency-key': 'worker-http-project' },
      payload: {
        displayName: 'Worker fixture',
        source: { kind: 'local_git', rootPath: root },
      },
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const projectId = registered.json<{ id: string }>().id;

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'worker-http-task' },
      payload: { message: 'Plan a README update.', projectId },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const initial = submitted.json<{
      runId: string;
      runStatus: string;
    }>();
    assert.equal(initial.runStatus, 'deciding');

    const pending = await waitForRun(app, initial.runId, 'awaiting_approval');
    assert.ok(pending.approval);
    assert.equal(pending.approval.status, 'pending');
    assert.deepEqual(pending.approval.proposedArguments, {
      objective: 'Plan a README update.',
      ticket: {
        reference: 'untracked',
        details: 'Plan a README update.',
      },
      project: { name: 'Worker fixture' },
    });

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);
    assert.equal(
      approved.json<{ runStatus: string }>().runStatus,
      'awaiting_approval',
    );

    const completed = await waitForRun(app, initial.runId, 'succeeded');
    assert.ok(completed.output?.artifact);
    const artifact = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${completed.output.artifact.id}`,
    });
    assert.equal(artifact.statusCode, 200, artifact.body);
  });

  void it('plans and executes one goal across separate approvals and durable artifact handoffs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-goal-http-'));
    await executeFile('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# Goal fixture\n', 'utf8');
    await executeFile('git', ['add', 'README.md'], { cwd: root });
    await executeFile(
      'git',
      [
        '-c',
        'user.name=Vera Test',
        '-c',
        'user.email=vera@example.test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const app = createApp(config());
    cleanups.push(
      async () => app.close(),
      async () => rm(root, { recursive: true, force: true }),
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { 'idempotency-key': 'goal-http-project' },
      payload: {
        displayName: 'Goal fixture',
        source: { kind: 'local_git', rootPath: root },
      },
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const projectId = registered.json<{ id: string }>().id;

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'goal-http-task' },
      payload: {
        message: 'Plan and implement a README update.',
        projectId,
      },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;
    const planning = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(planning.approval);
    assert.deepEqual(planning.approval.proposedArguments.project, {
      name: 'Goal fixture',
    });

    const approvedPlanning = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${planning.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedPlanning.statusCode, 202, approvedPlanning.body);
    const change = await waitForNextApproval(app, runId, planning.approval.id);
    assert.ok(change.goal);
    assert.ok(change.approval);
    assert.equal(change.goal.currentStepIndex, 1);
    assert.equal(change.approval.capability.name, 'software_change');
    assert.equal(
      change.approval.inputArtifacts?.[0]?.type,
      'implementation_plan',
    );
    assert.ok(
      change.approval.authority?.dataClasses.includes('artifact_content'),
    );

    const approvedChange = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${change.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedChange.statusCode, 202, approvedChange.body);
    const completed = await waitForRun(app, runId, 'succeeded');
    assert.ok(completed.goal);
    if (completed.output?.kind !== 'goal_result') {
      throw new Error('The completed run did not contain a goal result.');
    }
    assert.ok(completed.output.artifacts);
    assert.ok(completed.output.artifacts[0]);
    assert.ok(completed.output.artifacts[1]);
    assert.equal(completed.goal.status, 'succeeded');
    assert.equal(completed.output.artifacts.length, 2);
    const finalArtifact = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${completed.output.artifacts[1].id}`,
    });
    assert.equal(finalArtifact.statusCode, 200, finalArtifact.body);
    assert.equal(
      finalArtifact.json<{ inputs?: { id: string }[] }>().inputs?.[0]?.id,
      completed.output.artifacts[0].id,
    );
  });

  void it('discovers and executes approved project-independent web research end to end', async () => {
    const researchConfig = config();
    researchConfig.research = { adapterId: 'deterministic_research' };
    const app = createApp(researchConfig);
    cleanups.push(async () => app.close());

    const catalogResponse = await app.inject({
      method: 'GET',
      url: '/v1/capabilities',
    });
    assert.equal(catalogResponse.statusCode, 200, catalogResponse.body);
    const catalog = catalogResponse.json<{
      capabilities: {
        name: string;
        enabled: boolean;
        destination?: { adapterId: string };
        authority: {
          projectContext: string;
          networkAccess: string;
          maxWebSearchCalls?: number;
        };
      }[];
    }>();
    const research = catalog.capabilities.find(
      (capability) => capability.name === 'web_research',
    );
    assert.deepEqual(research, {
      name: 'web_research',
      version: 1,
      description:
        'Research a project-independent question on the public web and return a source-backed report.',
      effect: 'external',
      artifact: {
        type: 'research_report',
        mediaType: 'application/vnd.vera.research-report+json',
      },
      acceptedInputArtifacts: [],
      authority: {
        approval: 'always',
        projectContext: 'none',
        networkAccess: 'none',
        dataClasses: ['owner_request', 'public_web'],
        sideEffects: [],
        credentials: 'none',
        maxWebSearchCalls: 4,
      },
      enabled: true,
      destination: {
        schemaVersion: 1,
        adapterId: 'deterministic_research',
        provider: 'deterministic',
        transport: 'in_process',
        dataBoundary: 'owner_controlled',
      },
    });

    const objective = 'Research the evidence for durable task execution.';
    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'worker-http-research' },
      payload: { message: objective },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;

    const pending = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(pending.approval);
    assert.deepEqual(pending.approval.proposedArguments, { objective });
    assert.equal(
      (pending.approval as { capability?: { name: string } }).capability?.name,
      'web_research',
    );
    assert.equal(
      (
        pending.approval as {
          authority?: { projectContext: string; maxWebSearchCalls?: number };
        }
      ).authority?.projectContext,
      'none',
    );
    assert.equal(
      (
        pending.approval as {
          authority?: { projectContext: string; maxWebSearchCalls?: number };
        }
      ).authority?.maxWebSearchCalls,
      4,
    );

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);

    const completed = await waitForRun(app, runId, 'succeeded');
    assert.equal(completed.output?.kind, 'research_report');
    assert.ok(completed.output.artifact);

    const artifactResponse = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${completed.output.artifact.id}`,
    });
    assert.equal(artifactResponse.statusCode, 200, artifactResponse.body);
    const artifact = artifactResponse.json<{
      type: string;
      projectId?: string;
      content: {
        objective: string;
        report: string;
        sources: { title: string; url: string }[];
      };
    }>();
    assert.equal(artifact.type, 'research_report');
    assert.equal(artifact.projectId, undefined);
    assert.equal(artifact.content.objective, objective);
    assert.match(artifact.content.report, /deterministic/iu);
    assert.deepEqual(artifact.content.sources, [
      {
        title: 'Deterministic research fixture',
        url: 'https://example.com/vera/research-fixture',
      },
    ]);

    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}/events`,
    });
    assert.equal(eventsResponse.statusCode, 200, eventsResponse.body);
    const eventTypes = eventsResponse
      .json<{ events: { type: string }[] }>()
      .events.map((event) => event.type);
    assert.equal(eventTypes.includes('context_assembled'), false);
    assert.equal(eventTypes.includes('artifact_created'), true);
    assert.equal(eventTypes.at(-1), 'run_succeeded');
  });

  void it('creates and exposes an approved durable personal task end to end', async () => {
    const app = createApp(config());
    cleanups.push(async () => app.close());

    const catalogResponse = await app.inject({
      method: 'GET',
      url: '/v1/capabilities',
    });
    assert.equal(catalogResponse.statusCode, 200, catalogResponse.body);
    const personalCapability = catalogResponse
      .json<{
        capabilities: {
          name: string;
          enabled: boolean;
          destination?: { adapterId: string };
        }[];
      }>()
      .capabilities.find(
        (capability) => capability.name === 'personal_task_management',
      );
    assert.ok(personalCapability);
    assert.equal(personalCapability.enabled, true);
    assert.equal(
      personalCapability.destination?.adapterId,
      'vera_personal_tasks',
    );

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'personal-task-create-http' },
      payload: { message: 'Add a task: Buy milk' },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;
    const pending = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(pending.approval);
    const approval = pending.approval;
    assert.deepEqual(approval.proposedArguments, {
      action: 'create',
      title: 'Buy milk',
    });
    assert.equal(
      (approval as unknown as { capability: { name: string } }).capability.name,
      'personal_task_management',
    );
    assert.deepEqual(
      (approval as unknown as { authority: { sideEffects: string[] } })
        .authority.sideEffects,
      ['personal_data_write'],
    );

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);
    const completed = await waitForRun(app, runId, 'succeeded');
    const completedOutput = completed.output;
    assert.ok(completedOutput);
    assert.equal(completedOutput.kind, 'personal_task_result');
    assert.ok(completedOutput.artifact);

    const tasksResponse = await app.inject({
      method: 'GET',
      url: '/v1/personal-tasks?status=open&limit=10',
    });
    assert.equal(tasksResponse.statusCode, 200, tasksResponse.body);
    const tasks = tasksResponse.json<{
      tasks: { id: string; title: string; status: string }[];
    }>().tasks;
    assert.equal(tasks.length, 1);
    const personalTask = tasks[0];
    assert.ok(personalTask);
    assert.equal(personalTask.title, 'Buy milk');
    assert.equal(personalTask.status, 'open');
    assert.ok(personalTask.id);

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/v1/personal-tasks/${personalTask.id}`,
    });
    assert.equal(taskResponse.statusCode, 200, taskResponse.body);
    assert.equal(taskResponse.json<{ title: string }>().title, 'Buy milk');

    const artifactResponse = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${completedOutput.artifact.id}`,
    });
    assert.equal(artifactResponse.statusCode, 200, artifactResponse.body);
    assert.equal(
      artifactResponse.json<{ type: string }>().type,
      'personal_task_result',
    );
  });

  void it('applies one approved software-change artifact to a durable managed worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-application-project-'));
    const workspaces = await mkdtemp(
      join(tmpdir(), 'vera-application-workspaces-'),
    );
    await executeFile('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# Application fixture\n', 'utf8');
    await executeFile('git', ['add', 'README.md'], { cwd: root });
    await executeFile(
      'git',
      [
        '-c',
        'user.name=Vera Test',
        '-c',
        'user.email=vera@example.test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const app = createApp(config(workspaces));
    cleanups.push(
      async () => app.close(),
      async () => rm(root, { recursive: true, force: true }),
      async () => rm(workspaces, { recursive: true, force: true }),
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { 'idempotency-key': 'application-project' },
      payload: {
        displayName: 'Application fixture',
        source: { kind: 'local_git', rootPath: root },
      },
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const projectId = registered.json<{ id: string }>().id;

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'application-change' },
      payload: { message: 'Implement the approved fixture change.', projectId },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;
    const pending = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(pending.approval);
    const approvedChange = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${pending.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedChange.statusCode, 202, approvedChange.body);
    const completedChange = await waitForRun(app, runId, 'succeeded');
    assert.ok(completedChange.output?.artifact);

    const requestedApplication = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${completedChange.output.artifact.id}/applications`,
      headers: { 'idempotency-key': 'application-effect' },
    });
    assert.equal(
      requestedApplication.statusCode,
      202,
      requestedApplication.body,
    );
    const pendingApplication = requestedApplication.json<{
      id: string;
      status: string;
      approval: { effect: { staged: boolean; workspacePath: string } };
    }>();
    assert.equal(pendingApplication.status, 'awaiting_approval');
    assert.equal(pendingApplication.approval.effect.staged, true);

    const approvedApplication = await app.inject({
      method: 'POST',
      url: `/v1/change-applications/${pendingApplication.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedApplication.statusCode, 202, approvedApplication.body);
    const completedApplication = await waitForApplication(
      app,
      pendingApplication.id,
      'succeeded',
    );
    assert.ok(completedApplication.result);
    assert.equal(
      await readFile(join(root, 'README.md'), 'utf8'),
      '# Application fixture\n',
    );
    assert.match(
      await readFile(
        join(
          completedApplication.result.workspacePath,
          'VERA_DETERMINISTIC_CHANGE.md',
        ),
        'utf8',
      ),
      /Implement the approved fixture change\./u,
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${completedChange.output.artifact.id}/applications`,
      headers: { 'idempotency-key': 'application-effect' },
    });
    assert.equal(duplicate.statusCode, 202, duplicate.body);
    assert.equal(duplicate.json<{ id: string }>().id, pendingApplication.id);

    const events = await app.inject({
      method: 'GET',
      url: `/v1/change-applications/${pendingApplication.id}/events`,
    });
    assert.equal(events.statusCode, 200, events.body);
    assert.deepEqual(
      events
        .json<{ events: { type: string }[] }>()
        .events.map((event) => event.type),
      [
        'change_application_created',
        'change_application_approval_requested',
        'change_application_approval_approved',
        'change_application_started',
        'change_application_succeeded',
      ],
    );
  });
});
