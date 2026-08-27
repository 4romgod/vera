import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConfiguredMachineOperations } from '../../../../src/adapters/outbound/machines/configured-machine-operations.ts';
import { MachineCatalogSchema } from '../../../../src/domain/machines/machine.ts';

void test('registered local service actions are exact, verified, and recovery-safe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vera-machine-'));
  const stateFile = join(root, 'service-state');
  const counterFile = join(root, 'action-count');
  const script = [
    "const fs=require('node:fs');",
    'const [action,state,counter]=process.argv.slice(1);',
    "const count=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0;",
    "if(action==='probe')process.exit(fs.existsSync(state)?0:1);",
    'fs.writeFileSync(counter,String(count+1));',
    "if(action==='stop'){if(fs.existsSync(state))fs.unlinkSync(state);}else{fs.writeFileSync(state,'healthy');}",
  ].join('');
  const command = (action: string) => ({
    executable: process.execPath,
    arguments: ['-e', script, action, stateFile, counterFile],
    timeoutMs: 2_000,
  });
  const operations = new ConfiguredMachineOperations(
    MachineCatalogSchema.parse({
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
              actions: {
                start: command('start'),
                stop: command('stop'),
                restart: command('restart'),
              },
            },
          ],
        },
      ],
    }),
  );

  try {
    const initial = await operations.inspect({
      machineId: 'test-machine',
      serviceIds: ['test-service'],
    });
    assert.equal(initial.services[0]?.observation.status, 'unhealthy');

    const started = await operations.manageService(
      {
        machineId: 'test-machine',
        serviceId: 'test-service',
        action: 'start',
      },
      { recovery: false },
    );
    assert.equal(started.before.status, 'unhealthy');
    assert.equal(started.after.status, 'healthy');
    assert.equal(started.verified, true);
    assert.equal(await readFile(counterFile, 'utf8'), '1');

    const recovered = await operations.manageService(
      {
        machineId: 'test-machine',
        serviceId: 'test-service',
        action: 'start',
      },
      { recovery: true },
    );
    assert.match(recovered.execution.summary, /was not repeated/u);
    assert.equal(await readFile(counterFile, 'utf8'), '1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('catalog rejects non-command probes for SSH machines', () => {
  const parsed = MachineCatalogSchema.safeParse({
    schemaVersion: 1,
    machines: [
      {
        id: 'remote',
        displayName: 'Remote',
        adapter: { kind: 'ssh', host: 'remote.example' },
        services: [
          {
            id: 'api',
            displayName: 'API',
            probe: { kind: 'tcp', host: '127.0.0.1', port: 4310 },
            actions: {},
          },
        ],
      },
    ],
  });
  assert.equal(parsed.success, false);
});

void test('catalog rejects SSH targets that could be interpreted as options', () => {
  const parsed = MachineCatalogSchema.safeParse({
    schemaVersion: 1,
    machines: [
      {
        id: 'remote',
        displayName: 'Remote',
        adapter: { kind: 'ssh', host: '-oProxyCommand=unexpected' },
        services: [],
      },
    ],
  });
  assert.equal(parsed.success, false);
});
