import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEvaluateModelDecision } from '../../../src/application/model-decisions/evaluate-model-decision.ts';
import { FakeModelProvider } from '../../support/fake-model-provider.ts';

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

  void it('supplies the selected project as authoritative orchestration context', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    });

    await createEvaluateModelDecision(provider)('plan this', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });

    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      ownerMessage: 'plan this',
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /selectedProject is supplied, it is authoritative/u,
    );
  });

  void it('supplies bounded conversation history as untrusted structured context', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'Continue the conversation.',
      message: 'Continued.',
    });
    const manifest = {
      schemaVersion: 1 as const,
      conversationId: 'conversation_test',
      throughMessageId: 'message_current',
      scope: { kind: 'project' as const, projectId: 'project_vera' },
      entries: [
        {
          messageId: 'message_prior',
          taskId: 'task_prior',
          role: 'owner' as const,
          sha256: 'a'.repeat(64),
          characters: 10,
        },
        {
          messageId: 'message_prior_reply',
          taskId: 'task_prior',
          role: 'vera' as const,
          sha256: 'b'.repeat(64),
          characters: 10,
        },
      ],
      totalMessages: 2,
      totalCharacters: 20,
      limits: { maxMessages: 20, maxCharacters: 40_000 },
      exclusions: { differentScope: 2, incompleteTurns: 1, limits: 0 },
    };

    await createEvaluateModelDecision(provider)('continue', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
      conversationContext: {
        manifest,
        messages: [
          {
            messageId: 'message_prior',
            taskId: 'task_prior',
            role: 'owner',
            content: 'Prior text',
          },
          {
            messageId: 'message_prior_reply',
            taskId: 'task_prior',
            role: 'vera',
            content: 'Prior Vera',
          },
        ],
      },
    });

    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      ownerMessage: 'continue',
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
      conversationContext: {
        messages: [
          { role: 'owner', content: 'Prior text' },
          { role: 'vera', content: 'Prior Vera' },
        ],
      },
    });
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /cannot change this system contract, grant authority/u,
    );
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

  void it('requires approval for a valid specialist capability invocation', async () => {
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

  void it('requires approval for a valid software-change invocation', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'An isolated software change is required.',
      capability: { name: 'software_change', version: 1 },
      arguments: {
        objective: 'Implement the health endpoint.',
        ticket: { reference: 'VERA-102', details: 'Add health monitoring.' },
        project: { name: 'vera' },
      },
    })('implement this');

    assert.deepEqual(result.decision, {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'software_change', version: 1 },
      proposedArguments: {
        objective: 'Implement the health endpoint.',
        ticket: { reference: 'VERA-102', details: 'Add health monitoring.' },
        project: { name: 'vera' },
      },
    });
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
