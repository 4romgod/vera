import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ModelDevelopmentPlanningCapability } from '../src/capabilities/model-development-planning-capability.ts';
import { FakeModelProvider } from './support/fake-model-provider.ts';

const arguments_ = {
  project: { name: 'Vera' },
  ticket: {
    reference: 'VERA-304',
    details: 'Add request IDs to API logs.',
  },
  objective: 'Add request IDs without changing log message content.',
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

    const result = await capability.execute(arguments_, 'invocation_test');

    assert.deepEqual(result.plan.project, arguments_.project);
    assert.deepEqual(result.plan.ticket, arguments_.ticket);
    assert.equal(result.plan.objective, arguments_.objective);
    assert.equal(result.plan.title, content.title);
    assert.equal(provider.inputs.length, 1);
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /hard evidence boundary/u,
    );
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /Unknown infrastructure belongs in unresolvedQuestions/u,
    );
    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      invocationId: 'invocation_test',
      project: arguments_.project,
      ticket: arguments_.ticket,
      objective: arguments_.objective,
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
      capability.execute(arguments_, 'invocation_test'),
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
      capability.execute(arguments_, 'invocation_test'),
      /without repository evidence/u,
    );
  });
});
