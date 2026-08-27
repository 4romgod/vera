import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { AppConfig } from '../../../../src/bootstrap/config.ts';
import { createApp } from '../../../../src/bootstrap/wiring.ts';

const cleanups: (() => Promise<void>)[] = [];

function config(stateFile: string): AppConfig {
  const script = [
    "const fs=require('node:fs');",
    'const [action,state]=process.argv.slice(1);',
    "if(action==='probe')process.exit(fs.existsSync(state)?0:1);",
    "if(action==='stop'){if(fs.existsSync(state))fs.unlinkSync(state);}else{fs.writeFileSync(state,'healthy');}",
  ].join('');
  const command = (action: string) => ({
    executable: process.execPath,
    arguments: ['-e', script, action, stateFile],
    timeoutMs: 2_000,
  });
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
    transcription: { provider: 'disabled', maxAudioBytes: 25_000_000 },
    application: { workspacesRoot: '/tmp/vera-machine-test-workspaces' },
    publication: {
      adapterId: 'github_gh_cli',
      gitCommand: 'git',
      ghCommand: 'gh',
    },
    worker: { concurrency: 1, pollIntervalMs: 5, leaseMs: 900_000 },
    reminders: {
      ownerTimeZone: 'Africa/Johannesburg',
      concurrency: 1,
      pollIntervalMs: 25,
      leaseMs: 1_000,
    },
    machines: {
      schemaVersion: 1,
      machines: [
        {
          id: 'test-machine',
          displayName: 'Test machine',
          adapter: { kind: 'local' },
          diagnostics: [],
          services: [
            {
              id: 'test-service',
              displayName: 'Test service',
              probe: {
                kind: 'command',
                command: command('probe'),
                healthyExitCodes: [0],
              },
              actions: { restart: command('restart') },
            },
          ],
        },
        {
          id: 'remote-machine',
          displayName: 'Remote machine',
          adapter: {
            kind: 'ssh',
            host: 'owner@remote.example',
            command: process.execPath,
            arguments: [],
          },
          diagnostics: [],
          services: [
            {
              id: 'remote-service',
              displayName: 'Remote service',
              probe: {
                kind: 'command',
                command: {
                  executable: '/usr/bin/true',
                  arguments: [],
                  timeoutMs: 2_000,
                },
                healthyExitCodes: [0],
              },
              actions: {
                restart: {
                  executable: '/usr/bin/true',
                  arguments: [],
                  timeoutMs: 2_000,
                },
              },
            },
          ],
        },
      ],
    },
  };
}

async function waitForRun(
  app: ReturnType<typeof createApp>,
  runId: string,
  predicate: (body: Record<string, unknown>) => boolean,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<Record<string, unknown>>();
    if (predicate(body)) return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach the expected state.`);
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => cleanup()));
});

void describe('governed machine operations HTTP journey', () => {
  void it('inspects, separately approves a conditional restart, and verifies it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vera-machine-http-'));
    const app = createApp(config(join(root, 'service-state')));
    cleanups.push(
      async () => app.close(),
      async () => rm(root, { recursive: true, force: true }),
    );

    const catalog = await app.inject({ method: 'GET', url: '/v1/machines' });
    assert.equal(catalog.statusCode, 200, catalog.body);
    const machineCatalog = catalog.json<{
      machines: { services: { actions: string[] }[] }[];
    }>();
    assert.deepEqual(machineCatalog.machines[0]?.services[0]?.actions, [
      'restart',
    ]);

    const capabilityResponse = await app.inject({
      method: 'GET',
      url: '/v1/capabilities',
    });
    assert.equal(capabilityResponse.statusCode, 200, capabilityResponse.body);
    const machineCapability = capabilityResponse
      .json<{
        capabilities: {
          name: string;
          destination?: unknown;
          authority: { networkAccess: string; credentials: string };
        }[];
      }>()
      .capabilities.find(({ name }) => name === 'machine_inspection');
    assert.ok(machineCapability);
    assert.equal(machineCapability.destination, undefined);
    assert.equal(machineCapability.authority.networkAccess, 'owner_machine');
    assert.equal(machineCapability.authority.credentials, 'server_managed');

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'machine-conditional-restart' },
      payload: {
        message:
          'Check service test-service on test-machine and if it is unhealthy then restart it.',
      },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;

    const inspection = await waitForRun(
      app,
      runId,
      (body) => body.runStatus === 'awaiting_approval',
    );
    const inspectionApproval = inspection.approval as {
      id: string;
      capability: { name: string };
      destination: { adapterId: string };
      authority: {
        networkAccess: string;
        credentials: string;
        sideEffects: string[];
      };
    };
    assert.equal(inspectionApproval.capability.name, 'machine_inspection');
    assert.equal(
      inspectionApproval.destination.adapterId,
      'machine.test-machine',
    );
    assert.equal(inspectionApproval.authority.networkAccess, 'none');
    assert.equal(inspectionApproval.authority.credentials, 'none');
    assert.deepEqual(inspectionApproval.authority.sideEffects, []);

    const approvedInspection = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${inspectionApproval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedInspection.statusCode, 202, approvedInspection.body);

    const action = await waitForRun(app, runId, (body) => {
      const approval = body.approval as { id?: string } | undefined;
      return (
        body.runStatus === 'awaiting_approval' &&
        approval?.id !== inspectionApproval.id
      );
    });
    const actionApproval = action.approval as {
      id: string;
      capability: { name: string };
      proposedArguments: Record<string, unknown>;
      inputArtifacts: { type: string }[];
      authority: { sideEffects: string[] };
    };
    assert.equal(actionApproval.capability.name, 'machine_service_management');
    assert.deepEqual(actionApproval.proposedArguments, {
      machineId: 'test-machine',
      serviceId: 'test-service',
      action: 'restart',
    });
    assert.equal(actionApproval.inputArtifacts[0]?.type, 'machine_diagnostic');
    assert.deepEqual(actionApproval.authority.sideEffects, [
      'machine_service_control',
    ]);

    const approvedAction = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${actionApproval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approvedAction.statusCode, 202, approvedAction.body);
    const completed = await waitForRun(
      app,
      runId,
      (body) => body.runStatus === 'succeeded',
    );
    const output = completed.output as {
      kind: string;
      artifacts: { type: string }[];
    };
    assert.equal(output.kind, 'adaptive_goal_result');
    assert.deepEqual(
      output.artifacts.map(({ type }) => type),
      ['machine_diagnostic', 'machine_service_action_result'],
    );

    const remoteSubmitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'remote-machine-inspection' },
      payload: {
        message: 'Inspect service remote-service on remote-machine.',
      },
    });
    assert.equal(remoteSubmitted.statusCode, 202, remoteSubmitted.body);
    const remoteApprovalRun = await waitForRun(
      app,
      remoteSubmitted.json<{ runId: string }>().runId,
      (body) => body.runStatus === 'awaiting_approval',
    );
    const remoteApproval = remoteApprovalRun.approval as {
      id: string;
      destination: { adapterId: string; transport: string };
      authority: { networkAccess: string; credentials: string };
    };
    assert.deepEqual(remoteApproval.destination, {
      schemaVersion: 1,
      adapterId: 'machine.remote-machine',
      provider: 'ssh',
      transport: 'ssh',
      dataBoundary: 'owner_controlled',
    });
    assert.equal(remoteApproval.authority.networkAccess, 'owner_machine');
    assert.equal(remoteApproval.authority.credentials, 'server_managed');

    const rejectedRemote = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${remoteApproval.id}/decision`,
      payload: { decision: 'rejected' },
    });
    assert.equal(rejectedRemote.statusCode, 202, rejectedRemote.body);
  });
});
