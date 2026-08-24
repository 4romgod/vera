import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEvaluateModelDecision } from '../src/application/evaluate-model-decision.ts';
import { FakeModelProvider } from './support/fake-model-provider.ts';

function evaluator(candidate: unknown) {
  return createEvaluateModelDecision(
    new FakeModelProvider(candidate),
    () => 'decision_test',
  );
}

void describe('model decision boundary', () => {
  void it('requires capability arguments to preserve the user-stated scope', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    });

    await createEvaluateModelDecision(provider)('plan request IDs');

    assert.equal(provider.inputs.length, 1);
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /faithfully restate only the requested outcome/u,
    );
    assert.equal(provider.inputs[0]?.message, 'plan request IDs');
  });

  void it('turns a direct-response proposal into a response decision', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    })('hello');

    assert.equal(result.decisionId, 'decision_test');
    assert.deepEqual(result.decision, { kind: 'respond', message: 'Hello.' });
  });

  void it('requires approval for a valid external capability invocation', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'A development plan is required.',
      capability: { name: 'development_planning', version: 1 },
      arguments: {
        objective: 'Plan the health endpoint.',
        ticket: { reference: 'VERA-101', details: 'Add health monitoring.' },
        project: { name: 'vera' },
      },
    })('plan this');

    assert.equal(result.decision.kind, 'approval_required');
  });

  void it('rejects capabilities outside the model-visible contract', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Use a made-up capability.',
      capability: { name: 'delete_everything', version: 1 },
      arguments: {},
    })('do it');

    assert.equal(result.decision.kind, 'rejected');
    assert.equal(result.decision.code, 'invalid_model_output');
  });

  void it('rejects invalid capability arguments at the proposal boundary', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Plan the work.',
      capability: { name: 'development_planning', version: 1 },
      arguments: { objective: 'Missing required context.' },
    })('plan this');

    assert.equal(result.decision.kind, 'rejected');
    assert.equal(result.decision.code, 'invalid_model_output');
  });

  void it('rejects model output with extra authority-bearing fields', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'I approved this myself.',
      message: 'Done.',
      authorized: true,
    })('do it');

    assert.equal(result.proposal, null);
    assert.equal(result.decision.kind, 'rejected');
    assert.equal(result.decision.code, 'invalid_model_output');
  });
});
