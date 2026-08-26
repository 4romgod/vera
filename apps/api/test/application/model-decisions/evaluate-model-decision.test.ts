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

  void it('accepts a bounded compatible goal plan without authorizing its steps', async () => {
    const goal = {
      schemaVersion: 1,
      objective: 'Plan and implement request tracing.',
      summary: 'Plan the work, then use that plan to implement it.',
      steps: [
        {
          id: 'step_plan',
          purpose: 'Prepare the implementation plan.',
          inputStepIds: [],
          capability: 'development_planning',
          version: 1,
          arguments: {
            objective: 'Plan request tracing.',
            ticket: { reference: 'VERA-201', details: 'Add request tracing.' },
            project: { name: 'Vera' },
          },
        },
        {
          id: 'step_change',
          purpose: 'Implement the plan.',
          inputStepIds: ['step_plan'],
          capability: 'software_change',
          version: 1,
          arguments: {
            objective: 'Implement request tracing.',
            ticket: { reference: 'VERA-201', details: 'Add request tracing.' },
            project: { name: 'Vera' },
          },
        },
      ],
    };
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'execute_goal',
      decisionSummary: 'Two dependent specialist outcomes are required.',
      goal,
    })('plan and implement this', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });

    assert.deepEqual(result.decision, { kind: 'goal_planned', plan: goal });
  });

  void it('rejects a goal that rewrites the selected project identity', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'execute_goal',
      decisionSummary: 'Plan and implement in a different project.',
      goal: {
        schemaVersion: 1,
        objective: 'Plan and implement request tracing.',
        summary: 'Use two project capabilities.',
        steps: [
          {
            id: 'step_plan',
            purpose: 'Prepare the plan.',
            inputStepIds: [],
            capability: 'development_planning',
            version: 1,
            arguments: {
              objective: 'Plan tracing.',
              ticket: { reference: 'VERA-201', details: 'Add tracing.' },
              project: { name: 'Another project' },
            },
          },
          {
            id: 'step_change',
            purpose: 'Implement the plan.',
            inputStepIds: ['step_plan'],
            capability: 'software_change',
            version: 1,
            arguments: {
              objective: 'Implement tracing.',
              ticket: { reference: 'VERA-201', details: 'Add tracing.' },
              project: { name: 'Another project' },
            },
          },
        ],
      },
    })('plan and implement this', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });

    assert.equal(result.decision.kind, 'rejected');
    assert.equal(result.decision.code, 'invalid_goal_plan');
  });

  void it('rejects a goal whose artifact dependency points forward', async () => {
    const result = await evaluator({
      schemaVersion: 1,
      kind: 'execute_goal',
      decisionSummary: 'Use an invalid sequence.',
      goal: {
        schemaVersion: 1,
        objective: 'Implement and then plan.',
        summary: 'Invalid dependency order.',
        steps: [
          {
            id: 'step_change',
            purpose: 'Implement first.',
            inputStepIds: ['step_plan'],
            capability: 'software_change',
            version: 1,
            arguments: {
              objective: 'Implement.',
              ticket: { reference: 'VERA-201', details: 'Implement.' },
              project: { name: 'Vera' },
            },
          },
          {
            id: 'step_plan',
            purpose: 'Plan later.',
            inputStepIds: [],
            capability: 'development_planning',
            version: 1,
            arguments: {
              objective: 'Plan.',
              ticket: { reference: 'VERA-201', details: 'Plan.' },
              project: { name: 'Vera' },
            },
          },
        ],
      },
    })('do this backwards');

    assert.equal(result.decision.kind, 'rejected');
    assert.equal(result.decision.code, 'invalid_model_output');
  });

  void it('exposes and accepts web research only when its runtime is enabled', async () => {
    const candidate = {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Current public evidence is required.',
      capability: { name: 'web_research', version: 1 },
      arguments: { objective: 'Research current durable execution patterns.' },
    };
    const disabledProvider = new FakeModelProvider(candidate);
    const disabled =
      await createEvaluateModelDecision(disabledProvider)('research this');
    assert.equal(disabled.decision.kind, 'rejected');
    assert.equal(disabled.decision.code, 'invalid_model_output');
    assert.equal(
      JSON.stringify(disabledProvider.inputs[0]?.outputSchema).includes(
        'web_research',
      ),
      false,
    );

    const enabledProvider = new FakeModelProvider(candidate);
    const enabled = await createEvaluateModelDecision(
      enabledProvider,
      () => 'decision_research',
      {
        enabledCapabilities: [
          { name: 'development_planning', version: 1 },
          { name: 'software_change', version: 1 },
          { name: 'web_research', version: 1 },
        ],
      },
    )('research this');

    assert.deepEqual(enabled.decision, {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'web_research', version: 1 },
      proposedArguments: {
        objective: 'Research current durable execution patterns.',
      },
    });
    assert.match(
      enabledProvider.inputs[0]?.systemPrompt ?? '',
      /web_research/u,
    );
    assert.equal(
      JSON.stringify(enabledProvider.inputs[0]?.outputSchema).includes(
        'web_research',
      ),
      true,
    );
  });

  void it('accepts only schema-valid owner-scoped personal task actions when enabled', async () => {
    const candidate = {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'The owner asked to create a personal task.',
      capability: { name: 'personal_task_management', version: 1 },
      arguments: { action: 'create', title: 'Buy milk' },
    };
    const provider = new FakeModelProvider(candidate);
    const result = await createEvaluateModelDecision(
      provider,
      () => 'decision_personal_task',
      {
        enabledCapabilities: [{ name: 'personal_task_management', version: 1 }],
      },
    )('Add a task to buy milk.');

    assert.deepEqual(result.decision, {
      kind: 'approval_required',
      reason: 'specialist_capability_invocation',
      capability: { name: 'personal_task_management', version: 1 },
      proposedArguments: { action: 'create', title: 'Buy milk' },
    });
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /owner-scoped and project-independent/u,
    );
    assert.doesNotMatch(
      provider.inputs[0]?.systemPrompt ?? '',
      /execute_goal/u,
    );
  });

  void it('advertises only the enabled single-capability contract', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    });

    await createEvaluateModelDecision(provider, () => 'decision_research', {
      enabledCapabilities: [{ name: 'web_research', version: 1 }],
    })('hello');

    const prompt = provider.inputs[0]?.systemPrompt ?? '';
    const outputSchema = JSON.stringify(provider.inputs[0]?.outputSchema);
    assert.match(prompt, /invoke_capability/u);
    assert.match(prompt, /web_research/u);
    assert.doesNotMatch(prompt, /execute_goal/u);
    assert.doesNotMatch(prompt, /development_planning/u);
    assert.doesNotMatch(prompt, /software_change/u);
    assert.equal(outputSchema.includes('execute_goal'), false);
    assert.equal(outputSchema.includes('development_planning'), false);
    assert.equal(outputSchema.includes('software_change'), false);
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
