import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDevelopmentPlanningCapabilityRegistry } from '../../../../src/adapters/outbound/capabilities/development-planning/development-planning-adapter-registry.ts';
import type { KnowledgeService } from '../../../../src/ports/knowledge/knowledge-service.ts';
import { createDeterministicSoftwareChangeRegistry } from '../../../support/deterministic-software-change-registry.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';
import { createTestCapabilityRuntime } from '../../../support/test-capability-runtime.ts';

const attachment = {
  id: 'attachment_private',
  kind: 'document' as const,
  filename: 'private.txt',
  mediaType: 'text/plain' as const,
  byteLength: 42,
  sha256: 'a'.repeat(64),
};

const source = {
  schemaVersion: 1 as const,
  id: 'knowledge_private',
  revision: 1,
  title: 'Private source',
  scope: { kind: 'global' as const },
  sensitivity: 'personal' as const,
  status: 'active' as const,
  provenance: { kind: 'owner_attachments' as const, attachments: [attachment] },
  contentSha256: 'b'.repeat(64),
  createdAt: '2026-09-04T12:00:00.000Z',
  updatedAt: '2026-09-04T12:00:00.000Z',
  chunkCount: 1,
};

function knowledgeService(): KnowledgeService {
  return {
    add: () => Promise.reject(new Error('Not used.')),
    list: () => Promise.resolve([source]),
    get: () => Promise.resolve(source),
    remove: () => Promise.reject(new Error('Not used.')),
    search: () =>
      Promise.resolve({
        schemaVersion: 1,
        query: 'What is the private launch phrase?',
        citations: [
          {
            sourceId: source.id,
            sourceTitle: source.title,
            chunkId: 'knowledge_chunk_private_1',
            locator: 'private.txt · line 1',
            excerpt: 'The private launch phrase is amber-seven.',
            score: 15,
            attachments: [attachment],
          },
        ],
        searchedAt: '2026-09-04T12:00:01.000Z',
      }),
  };
}

void describe('knowledge capability boundary', () => {
  void it('requires disclosure approval and minimizes third-party model input', async () => {
    const provider = new FakeModelProvider(
      {
        answer: 'The private launch phrase is amber-seven.',
        citationIds: ['source_1'],
        limitations: [],
      },
      undefined,
      undefined,
      'third_party',
    );
    const registry = createTestCapabilityRuntime({
      developmentPlanning: createDevelopmentPlanningCapabilityRegistry({
        config: {
          adapterId: 'structured_model',
          codexCli: { command: 'codex' },
          dependencyTimeoutMs: 100,
        },
        provider,
      }),
      softwareChange: createDeterministicSoftwareChangeRegistry(),
      provider,
      knowledge: knowledgeService(),
    });
    const reference = { name: 'knowledge_management', version: 1 } as const;
    const selected = registry.selected(reference);
    assert.ok(selected);
    if (selected.destinationFor === undefined) {
      assert.fail('Knowledge capability must resolve its destination.');
    }
    const arguments_ = {
      action: 'search',
      query: 'What is the private launch phrase?',
    };
    const destination = selected.destinationFor(arguments_);
    const runtime = registry.resolve(reference, destination);
    assert.ok(runtime);
    assert.deepEqual(
      runtime.authorityFor({
        arguments: arguments_,
        hasInputArtifacts: false,
        hasDecisionEvidence: false,
      }),
      {
        approval: 'always',
        projectContext: 'none',
        networkAccess: 'provider_api',
        dataClasses: ['owner_request', 'personal_knowledge'],
        sideEffects: ['third_party_disclosure'],
        credentials: 'server_managed',
      },
    );

    const execution = await runtime.execute({
      invocationId: 'invocation_knowledge_cloud',
      principalId: 'owner_v1',
      startedAt: '2026-09-04T12:00:00.000Z',
      recovery: false,
      arguments: arguments_,
      limits: {
        maxDurationMs: 60_000,
        maxArtifactBytes: 1_000_000,
        maxChangedFiles: 0,
        maxWebSearchCalls: 0,
      },
    });

    assert.equal(execution.artifact.type, 'knowledge_result');
    assert.equal(provider.inputs.length, 1);
    const disclosed = provider.inputs[0]?.message ?? '';
    assert.match(disclosed, /source_1/u);
    assert.match(disclosed, /amber-seven/u);
    assert.doesNotMatch(disclosed, /knowledge_private/u);
    assert.doesNotMatch(disclosed, /knowledge_chunk_private_1/u);
    assert.doesNotMatch(disclosed, /attachment_private/u);
    assert.doesNotMatch(disclosed, /(?:a{64}|b{64})/u);
  });
});
