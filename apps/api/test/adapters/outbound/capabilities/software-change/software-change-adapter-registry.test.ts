import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canonicalSoftwareChangeAdapterId,
  createSoftwareChangeCapabilityRegistry,
  type SoftwareChangeAdapterConfig,
} from '../../../../../src/adapters/outbound/capabilities/software-change/software-change-adapter-registry.ts';
import { DeterministicSoftwareChangeCapability } from '../../../../../src/adapters/outbound/capabilities/software-change/deterministic-software-change-capability.ts';
import type { SoftwareChangeInvocation } from '../../../../../src/ports/capabilities/software-change-capability.ts';

function config(adapterId: string): SoftwareChangeAdapterConfig {
  return {
    adapterId,
    codexCli: { command: 'codex', model: 'gpt-test' },
    dependencyTimeoutMs: 250,
  };
}

void describe('software-change adapter registry', () => {
  void it('resolves compatibility aliases to canonical adapter identities', () => {
    assert.equal(canonicalSoftwareChangeAdapterId('codex'), 'codex_cli');
    assert.equal(
      canonicalSoftwareChangeAdapterId('deterministic'),
      'deterministic_change',
    );
  });

  void it('creates the owner-controlled deterministic adapter explicitly', () => {
    const capability = createSoftwareChangeCapabilityRegistry(
      config('deterministic_change'),
    ).selected();
    assert.deepEqual(capability.destination, {
      schemaVersion: 1,
      adapterId: 'deterministic_change',
      provider: 'deterministic',
      transport: 'in_process',
      dataBoundary: 'owner_controlled',
    });
  });

  void it('fails startup clearly for an unregistered adapter', () => {
    assert.throws(
      () => createSoftwareChangeCapabilityRegistry(config('unknown')),
      /Unknown software-change adapter/u,
    );
  });

  void it('produces a valid multiline deterministic patch', async () => {
    const capability = new DeterministicSoftwareChangeCapability();
    const result = await capability.execute({
      schemaVersion: 1,
      invocationId: 'invocation_multiline',
      arguments: {
        objective: 'First objective line.\nSecond objective line.',
        ticket: { reference: 'TEST-3', details: 'Exercise multiline output.' },
        project: { name: 'Synthetic' },
      },
      project: { id: 'project_synthetic', displayName: 'Synthetic' },
      context: {
        manifest: {
          schemaVersion: 1,
          projectId: 'project_synthetic',
          sourceKind: 'local_git',
          revision: 'abc123',
          generatedAt: '2026-08-24T18:00:00.000Z',
          entries: [],
          totalFiles: 0,
          totalBytes: 0,
          limits: { maxFiles: 10, maxBytes: 10_000, maxFileBytes: 1_000 },
          exclusions: ['Synthetic test exclusions.'],
        },
        documents: [],
      },
      limits: {
        maxDurationMs: 10_000,
        maxArtifactBytes: 50_000,
        maxChangedFiles: 10,
      },
    } satisfies SoftwareChangeInvocation);

    assert.match(result.change.patch, /@@ -0,0 \+1,4 @@/u);
    assert.match(
      result.change.patch,
      /\+First objective line\.\n\+Second objective line\./u,
    );
  });
});
