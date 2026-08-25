import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ModelDevelopmentPlanningCapability } from '../../../../../src/adapters/outbound/capabilities/development-planning/model-development-planning-capability.ts';
import { FakeModelProvider } from '../../../../support/fake-model-provider.ts';

const arguments_ = {
  project: { name: 'Vera' },
  ticket: {
    reference: 'VERA-304',
    details: 'Add request IDs to API logs.',
  },
  objective: 'Add request IDs without changing log message content.',
};

const invocation = {
  schemaVersion: 1 as const,
  invocationId: 'invocation_test',
  arguments: arguments_,
  project: { id: 'project_test', displayName: 'Vera' },
  context: {
    manifest: {
      schemaVersion: 1 as const,
      projectId: 'project_test',
      sourceKind: 'local_git' as const,
      revision: 'abc123',
      generatedAt: '2026-08-24T18:00:00.000Z',
      entries: [],
      totalFiles: 0,
      totalBytes: 0,
      limits: { maxFiles: 40, maxBytes: 200_000, maxFileBytes: 40_000 },
      exclusions: ['Test context is intentionally empty.'],
    },
    documents: [],
  },
  limits: { maxDurationMs: 60_000, maxArtifactBytes: 100_000 },
};

const content = {
  schemaVersion: 1,
  title: 'Add request IDs',
  summary: 'Propagate a bounded request identifier through logging context.',
  scope: ['Create and propagate one request identifier.'],
  nonGoals: ['Do not add a distributed tracing backend.'],
  assumptions: [],
  unresolvedQuestions: ['Which request ID header should be canonical?'],
  affectedProjectAreas: [],
  phases: [
    {
      name: 'Inspect and implement',
      objective: 'Find the HTTP and logging boundaries before changing them.',
      steps: [
        'Inspect the HTTP boundary.',
        'Implement request ID propagation.',
      ],
      verification: ['Assert one ID appears across request logs.'],
    },
  ],
  risks: ['Untrusted inbound IDs require length and character limits.'],
};

void describe('development planning capability', () => {
  void it('adds authoritative identity fields from approved arguments', async () => {
    const provider = new FakeModelProvider(content);
    const capability = new ModelDevelopmentPlanningCapability(provider);

    const result = await capability.execute(invocation);

    assert.deepEqual(result.plan.project, {
      name: 'Vera',
      id: 'project_test',
      revision: 'abc123',
    });
    assert.deepEqual(result.plan.ticket, arguments_.ticket);
    assert.equal(result.plan.objective, arguments_.objective);
    assert.equal(result.plan.title, content.title);
    assert.equal(provider.inputs.length, 1);
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /complete evidence boundary/u,
    );
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /Unknown infrastructure belongs in unresolvedQuestions/u,
    );
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /MUST return affectedProjectAreas as \[\], assumptions as \[\]/u,
    );
    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      invocationId: 'invocation_test',
      project: invocation.project,
      ticket: arguments_.ticket,
      objective: arguments_.objective,
      context: invocation.context,
    });
  });

  void it('rejects model attempts to provide authoritative identity fields', async () => {
    const capability = new ModelDevelopmentPlanningCapability(
      new FakeModelProvider({
        ...content,
        project: { name: 'Rewritten' },
        ticket: { reference: 'OTHER-1', details: 'Rewritten.' },
        objective: 'Rewritten.',
      }),
    );

    await assert.rejects(
      capability.execute(invocation),
      /failed schema validation/u,
    );
  });

  void it('rejects invented affected areas when no repository evidence was supplied', async () => {
    const capability = new ModelDevelopmentPlanningCapability(
      new FakeModelProvider({
        ...content,
        affectedProjectAreas: [
          {
            area: 'src/middleware',
            rationale: 'Assumed request middleware location.',
          },
        ],
      }),
    );

    await assert.rejects(
      capability.execute(invocation),
      /unapproved project area/u,
    );
  });

  void it('does not treat a fictitious child of an approved file as approved', async () => {
    const capability = new ModelDevelopmentPlanningCapability(
      new FakeModelProvider({
        ...content,
        affectedProjectAreas: [
          {
            area: 'README.md/fictitious-child',
            rationale: 'This path does not exist in the approved evidence.',
          },
        ],
      }),
    );

    await assert.rejects(
      capability.execute({
        ...invocation,
        context: {
          ...invocation.context,
          manifest: {
            ...invocation.context.manifest,
            entries: [
              {
                relativePath: 'README.md',
                sha256: '0'.repeat(64),
                bytes: 0,
                selectionReason: 'Synthetic test evidence.',
                classification: 'documentation',
              },
            ],
            totalFiles: 1,
          },
        },
      }),
      /unapproved project area/u,
    );
  });
});
