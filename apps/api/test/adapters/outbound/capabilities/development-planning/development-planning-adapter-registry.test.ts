import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canonicalPlanningAdapterId,
  createDevelopmentPlanningCapabilityRegistry,
} from '../../../../../src/adapters/outbound/capabilities/development-planning/development-planning-adapter-registry.ts';
import { FakeModelProvider } from '../../../../support/fake-model-provider.ts';

function config(adapterId: string) {
  return {
    adapterId,
    codexCli: { command: 'codex' },
    dependencyTimeoutMs: 250,
  };
}

void describe('development-planning adapter registry', () => {
  void it('resolves compatibility aliases to canonical adapter identities', () => {
    assert.equal(canonicalPlanningAdapterId('codex'), 'codex_cli');
    assert.equal(canonicalPlanningAdapterId('model'), 'structured_model');
    assert.equal(
      canonicalPlanningAdapterId('claude_code_cli'),
      'claude_code_cli',
    );
  });

  void it('creates a provider-neutral structured-model adapter', () => {
    const registry = createDevelopmentPlanningCapabilityRegistry({
      config: config('structured_model'),
      provider: new FakeModelProvider({}),
    });
    const capability = registry.selected();

    assert.deepEqual(capability.destination, {
      schemaVersion: 1,
      adapterId: 'structured_model',
      provider: 'fake',
      transport: 'in_process',
      dataBoundary: 'owner_controlled',
    });
  });

  void it('resolves a non-selected adapter only when its full destination still matches', () => {
    const registry = createDevelopmentPlanningCapabilityRegistry({
      config: config('structured_model'),
      provider: new FakeModelProvider({}),
    });
    const approvedCodexDestination = {
      schemaVersion: 1 as const,
      adapterId: 'codex_cli',
      provider: 'openai',
      transport: 'local_process',
      dataBoundary: 'third_party' as const,
    };

    assert.deepEqual(
      registry.resolve(approvedCodexDestination)?.destination,
      approvedCodexDestination,
    );
    assert.equal(
      registry.resolve({
        ...approvedCodexDestination,
        provider: 'anthropic',
      }),
      null,
    );
  });

  void it('fails startup clearly for an unregistered adapter', () => {
    assert.throws(
      () =>
        createDevelopmentPlanningCapabilityRegistry({
          config: config('claude_code_cli'),
          provider: new FakeModelProvider({}),
        }),
      /Unknown development-planning adapter "claude_code_cli".*codex_cli, structured_model/u,
    );
    assert.throws(
      () =>
        createDevelopmentPlanningCapabilityRegistry({
          config: config('constructor'),
          provider: new FakeModelProvider({}),
        }),
      /Unknown development-planning adapter "constructor"/u,
    );
  });
});
