import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEvaluateModelDecision } from '../../../src/application/model-decisions/evaluate-model-decision.ts';
import { FakeModelProvider } from '../../support/fake-model-provider.ts';

const currentTime = '2026-08-26T08:00:00.000Z';
const temporalContext = { currentTime, ownerTimeZone: 'Africa/Johannesburg' };

function evaluator(candidate: unknown) {
  return createEvaluateModelDecision(
    new FakeModelProvider(candidate),
    () => 'decision_test',
  );
}

void describe('model decision boundary', () => {
  void it('accepts a repository watch only for the exact selected project', async () => {
    const candidate = {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Draft the requested read-only GitHub watch.',
      capability: { name: 'routine_management', version: 1 },
      arguments: {
        action: 'create',
        routine: {
          title: 'Watch Vera on GitHub',
          schedule: { kind: 'interval', minutes: 15 },
          action: {
            kind: 'integration_awareness',
            integrationId: 'github',
            projectId: 'project_vera',
            categories: ['review_requested', 'failed_check'],
          },
        },
      },
    };
    const accepted = await createEvaluateModelDecision(
      new FakeModelProvider(candidate),
      () => 'decision_watch',
      {
        enabledCapabilities: [{ name: 'routine_management', version: 1 }],
      },
    )('Watch GitHub review requests and failed checks every 15 minutes.', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });
    assert.equal(accepted.decision.kind, 'approval_required');

    const rejected = await createEvaluateModelDecision(
      new FakeModelProvider({
        ...candidate,
        arguments: {
          ...candidate.arguments,
          routine: {
            ...candidate.arguments.routine,
            action: {
              ...candidate.arguments.routine.action,
              projectId: 'project_other',
            },
          },
        },
      }),
      () => 'decision_drifted_watch',
      {
        enabledCapabilities: [{ name: 'routine_management', version: 1 }],
      },
    )('Watch this project.', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });
    assert.deepEqual(rejected.decision, {
      kind: 'rejected',
      code: 'invalid_capability_arguments',
      message:
        'The proposed external watch does not preserve the selected project identity.',
    });
  });

  void it('resolves the latest repairable campaign from bounded software-delivery context', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Prepare the requested repair approval.',
      capability: { name: 'software_delivery_repair', version: 1 },
      arguments: {
        action: 'prepare_repair',
        campaignId: 'campaign_latest',
      },
    });
    const result = await createEvaluateModelDecision(
      provider,
      () => 'decision_delivery',
      {
        enabledCapabilities: [{ name: 'software_delivery_repair', version: 1 }],
      },
    )('Repair the failed checks on the latest pull request.', {
      softwareDeliveryContext: {
        schemaVersion: 1,
        generatedAt: currentTime,
        resources: [
          {
            kind: 'development_campaign',
            id: 'campaign_latest',
            status: 'review_required',
            objective: `Fix current CI ${'without disclosing excess detail '.repeat(30)}`,
            project: { id: 'project_vera', displayName: 'Vera' },
            repository: { owner: '4romgod', name: 'vera' },
            attemptCount: 1,
            maxAttempts: 3,
            repairAvailable: true,
            pullRequest: {
              number: 33,
              url: 'https://github.com/4romgod/vera/pull/33',
              headRevision: 'a'.repeat(40),
              checks: { pending: 0, passed: 2, failed: 1 },
            },
            createdAt: currentTime,
            updatedAt: currentTime,
          },
        ],
      },
    });

    assert.equal(result.decision.kind, 'approval_required');
    const disclosed = JSON.parse(provider.inputs[0]?.message ?? '{}') as {
      softwareDeliveryContext: {
        id: string;
        objective: string;
        project: unknown;
        pullRequest?: Record<string, unknown>;
      }[];
    };
    const disclosedCampaign = disclosed.softwareDeliveryContext[0];
    assert.ok(disclosedCampaign);
    assert.equal(disclosedCampaign.id, 'campaign_latest');
    assert.equal(disclosedCampaign.objective.length, 500);
    assert.deepEqual(disclosedCampaign.project, {
      displayName: 'Vera',
    });
    assert.equal(
      'headRevision' in (disclosedCampaign.pullRequest ?? {}),
      false,
    );
    assert.equal('url' in (disclosedCampaign.pullRequest ?? {}), false);
  });

  void it('asks for clarification instead of guessing between repairable campaigns', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'Prepare a repair.',
      capability: { name: 'software_delivery_repair', version: 1 },
      arguments: {
        action: 'prepare_repair',
        campaignId: 'campaign_one',
      },
    });
    const campaign = (id: string, objective: string) => ({
      kind: 'development_campaign' as const,
      id,
      status: 'review_required' as const,
      objective,
      project: { id: 'project_vera', displayName: 'Vera' },
      repository: { owner: '4romgod', name: 'vera' },
      attemptCount: 1,
      maxAttempts: 3,
      repairAvailable: true,
      createdAt: currentTime,
      updatedAt: currentTime,
    });
    const result = await createEvaluateModelDecision(provider, undefined, {
      enabledCapabilities: [{ name: 'software_delivery_repair', version: 1 }],
    })('Repair the failed checks.', {
      softwareDeliveryContext: {
        schemaVersion: 1,
        generatedAt: currentTime,
        resources: [
          campaign('campaign_one', 'First objective'),
          campaign('campaign_two', 'Second objective'),
        ],
      },
    });

    assert.deepEqual(result.decision, {
      kind: 'respond',
      message:
        'I found more than one software delivery that could be used to prepare a pull-request repair. Which one do you mean?\n' +
        'campaign_one — development campaign: First objective\n' +
        'campaign_two — development campaign: Second objective',
    });
  });

  void it('accepts a bounded mission only for the authoritative selected project', async () => {
    const result = await createEvaluateModelDecision(
      new FakeModelProvider({
        schemaVersion: 1,
        kind: 'invoke_capability',
        decisionSummary: 'Draft one bounded no-merge mission.',
        capability: { name: 'mission_management', version: 1 },
        arguments: {
          action: 'create',
          objective: 'Select and deliver one useful Vera improvement.',
          completionCriteria: 'One verified pull request is ready for review.',
          project: { name: 'Vera' },
          delivery: {
            commitMessage: 'feat: complete bounded mission',
            pullRequestTitle: 'Complete bounded mission',
          },
        },
      }),
      () => 'decision_mission',
      {
        enabledCapabilities: [{ name: 'mission_management', version: 1 }],
      },
    )('Run one mission while I am away.', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });

    assert.equal(result.decision.kind, 'approval_required');
    assert.equal(result.decision.capability.name, 'mission_management');
  });
  void it('requires capability arguments to preserve the user-stated scope', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    });

    await createEvaluateModelDecision(provider, undefined, {
      ownerTimeZone: temporalContext.ownerTimeZone,
      clock: () => currentTime,
    })('plan request IDs');

    assert.equal(provider.inputs.length, 1);
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /faithfully restate only the requested outcome/u,
    );
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /requirement id must begin with requirement_/u,
    );
    assert.doesNotMatch(
      provider.inputs[0]?.systemPrompt ?? '',
      /Required output schema/u,
    );
    assert.ok((provider.inputs[0]?.systemPrompt.length ?? Infinity) < 15_000);
    assert.equal(typeof provider.inputs[0]?.outputSchema, 'object');
    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      ownerMessage: 'plan request IDs',
      temporalContext,
    });
  });

  void it('supplies the selected project as authoritative orchestration context', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    });

    await createEvaluateModelDecision(provider, undefined, {
      ownerTimeZone: temporalContext.ownerTimeZone,
      clock: () => currentTime,
    })('plan this', {
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });

    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      ownerMessage: 'plan this',
      temporalContext,
      selectedProject: { id: 'project_vera', displayName: 'Vera' },
    });
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /selectedProject is supplied, it is authoritative/u,
    );
  });

  void it('discloses only minimal attachment metadata during orchestration', async () => {
    const provider = new FakeModelProvider(
      {
        schemaVersion: 1,
        kind: 'respond',
        decisionSummary: 'Acknowledge the document.',
        message: 'I can analyze the attached document after approval.',
      },
      undefined,
      undefined,
      'third_party',
    );

    const result = await createEvaluateModelDecision(provider, undefined, {
      ownerTimeZone: temporalContext.ownerTimeZone,
      clock: () => currentTime,
    })('analyze this', {
      attachments: [
        {
          id: 'attachment_private',
          kind: 'document',
          filename: 'brief.md',
          mediaType: 'text/markdown',
          byteLength: 123,
          sha256: 'a'.repeat(64),
        },
      ],
    });

    const input = JSON.parse(provider.inputs[0]?.message ?? '{}') as {
      attachments: unknown[];
    };
    assert.deepEqual(input.attachments, [
      {
        filename: 'brief.md',
        mediaType: 'text/markdown',
        byteLength: 123,
      },
    ]);
    assert.doesNotMatch(
      provider.inputs[0]?.message ?? '',
      /attachment_private|a{64}/u,
    );
    assert.deepEqual(result.decision, {
      kind: 'rejected',
      code: 'invalid_capability_arguments',
      message:
        'The current attachments require attachment_analysis before Vera can make claims about their content.',
    });
  });

  void it('uses a caller-frozen request instant with the configured owner time zone', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'No specialist is needed.',
      message: 'Hello.',
    });

    await createEvaluateModelDecision(provider, undefined, {
      ownerTimeZone: temporalContext.ownerTimeZone,
      clock: () => '2099-01-01T00:00:00.000Z',
    })('remind me later', {
      temporalContext: { currentTime },
    });

    assert.deepEqual(JSON.parse(provider.inputs[0]?.message ?? '{}'), {
      ownerMessage: 'remind me later',
      temporalContext,
    });
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

    await createEvaluateModelDecision(provider, undefined, {
      ownerTimeZone: temporalContext.ownerTimeZone,
      clock: () => currentTime,
    })('continue', {
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
      temporalContext,
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

  void it('discloses governed memory only to an owner-controlled orchestration provider', async () => {
    const candidate = {
      schemaVersion: 1,
      kind: 'respond',
      decisionSummary: 'Use the owner preference.',
      message: 'Use npm.',
    };
    const memoryContext = {
      schemaVersion: 1 as const,
      memories: [
        {
          memoryId: 'memory_preference',
          revision: 1,
          kind: 'preference' as const,
          subject: 'Package manager',
          content: 'Use npm.',
          scope: { kind: 'global' as const },
          sensitivity: 'personal' as const,
          updatedAt: currentTime,
          sha256: 'a'.repeat(64),
          characters: 23,
        },
      ],
      manifest: {
        schemaVersion: 1 as const,
        principalId: 'owner_v1',
        assembledAt: currentTime,
        entries: [
          {
            memoryId: 'memory_preference',
            revision: 1,
            sha256: 'a'.repeat(64),
            characters: 23,
          },
        ],
        totalMemories: 1,
        totalCharacters: 23,
        sha256: 'b'.repeat(64),
        limits: { maxMemories: 20, maxCharacters: 12_000 },
        exclusions: { differentScope: 0, limits: 0 },
      },
    };
    const ownerProvider = new FakeModelProvider(candidate);
    const thirdPartyProvider = new FakeModelProvider(
      candidate,
      undefined,
      undefined,
      'third_party',
    );

    await createEvaluateModelDecision(ownerProvider)('Which should I use?', {
      memoryContext,
    });
    await createEvaluateModelDecision(thirdPartyProvider)(
      'Which should I use?',
      { memoryContext },
    );

    const ownerInput = JSON.parse(ownerProvider.inputs[0]?.message ?? '{}') as {
      memoryContext?: unknown;
    };
    const thirdPartyInput = JSON.parse(
      thirdPartyProvider.inputs[0]?.message ?? '{}',
    ) as { memoryContext?: unknown };
    assert.deepEqual(ownerInput.memoryContext, [
      {
        kind: 'preference',
        subject: 'Package manager',
        content: 'Use npm.',
        scope: { kind: 'global' },
        sensitivity: 'personal',
      },
    ]);
    assert.equal('memoryContext' in thirdPartyInput, false);
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

  void it('accepts an adaptive goal with only its first evidence-producing step', async () => {
    const goal = {
      schemaVersion: 1 as const,
      objective: 'Research the forecast and conditionally create a reminder.',
      summary: 'Observe the research result before choosing the next action.',
      completionCriteria:
        'Create a reminder only if rain is expected, then explain the outcome.',
      requirements: [
        {
          id: 'requirement_research',
          description: 'Research the forecast.',
          capability: 'web_research',
          version: 1,
          condition: { kind: 'always' as const },
        },
        {
          id: 'requirement_reminder',
          description: 'Create a reminder if rain is expected.',
          capability: 'personal_reminder_management',
          version: 1,
          condition: {
            kind: 'evidence_dependent' as const,
            description: 'The forecast predicts rain.',
          },
        },
      ],
      firstStep: {
        id: 'step_1',
        purpose: 'Research the forecast.',
        inputStepIds: [],
        capability: 'web_research' as const,
        version: 1 as const,
        arguments: { objective: 'Check whether rain is expected tomorrow.' },
      },
    };
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'pursue_goal',
      decisionSummary: 'The next action depends on unseen evidence.',
      goal,
    });
    const result = await createEvaluateModelDecision(provider, undefined, {
      enabledCapabilities: [
        { name: 'web_research', version: 1 },
        { name: 'personal_reminder_management', version: 1 },
      ],
    })('Research the forecast and if it rains remind me.');

    assert.deepEqual(result.decision, {
      kind: 'adaptive_goal_planned',
      plan: goal,
    });
    assert.match(
      provider.inputs[0]?.systemPrompt ?? '',
      /later action or the final answer must depend on evidence/u,
    );
  });

  void it('restores an explicit owner outcome omitted from the model goal contract', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'pursue_goal',
      decisionSummary: 'Research first.',
      goal: {
        schemaVersion: 1,
        objective: 'Research the system and conditionally create a reminder.',
        summary: 'Observe the research result.',
        completionCriteria: 'Finish the owner request.',
        requirements: [
          {
            id: 'requirement_research',
            description: 'Research the system.',
            capability: 'web_research',
            version: 1,
            condition: { kind: 'always' },
          },
        ],
        firstStep: {
          id: 'step_1',
          purpose: 'Research the system.',
          inputStepIds: [],
          capability: 'web_research',
          version: 1,
          arguments: { objective: 'Verify whether the system works.' },
        },
      },
    });
    const result = await createEvaluateModelDecision(provider, undefined, {
      enabledCapabilities: [
        { name: 'web_research', version: 1 },
        { name: 'personal_reminder_management', version: 1 },
      ],
    })('Research whether it works and if it does then remind me tomorrow.');

    assert.equal(result.decision.kind, 'adaptive_goal_planned');
    assert.deepEqual(
      result.decision.plan.requirements.map(({ capability, condition }) => [
        capability,
        condition.kind,
      ]),
      [
        ['web_research', 'always'],
        ['personal_reminder_management', 'evidence_dependent'],
      ],
    );
  });

  void it('derives a missing unconditional requirement from the proposed first step', async () => {
    const provider = new FakeModelProvider({
      schemaVersion: 1,
      kind: 'pursue_goal',
      decisionSummary: 'Research first, then act on the evidence.',
      goal: {
        schemaVersion: 1,
        objective: 'Research the forecast and conditionally create a reminder.',
        summary: 'Observe the forecast before creating the reminder.',
        completionCriteria:
          'Obtain the forecast and create a reminder only if rain is expected.',
        requirements: [
          {
            id: 'requirement_reminder',
            description: 'Create a reminder if rain is expected.',
            capability: 'personal_reminder_management',
            version: 1,
            condition: {
              kind: 'evidence_dependent',
              description: 'The forecast predicts rain.',
            },
          },
        ],
        firstStep: {
          id: 'step_1',
          purpose: 'Research the forecast.',
          inputStepIds: [],
          capability: 'web_research',
          version: 1,
          arguments: { objective: 'Check whether rain is expected tomorrow.' },
        },
      },
    });

    const result = await createEvaluateModelDecision(provider, undefined, {
      enabledCapabilities: [
        { name: 'web_research', version: 1 },
        { name: 'personal_reminder_management', version: 1 },
      ],
    })('Research the forecast and if it rains remind me.');

    assert.equal(result.decision.kind, 'adaptive_goal_planned');
    assert.deepEqual(
      result.decision.plan.requirements.map(({ id, capability, condition }) => [
        id,
        capability,
        condition.kind,
      ]),
      [
        ['requirement_first_step', 'web_research', 'always'],
        [
          'requirement_reminder',
          'personal_reminder_management',
          'evidence_dependent',
        ],
      ],
    );
  });

  void it('does not expose adaptive evidence loops to an unapproved third-party brain', async () => {
    const provider = new FakeModelProvider(
      {
        schemaVersion: 1,
        kind: 'pursue_goal',
        decisionSummary: 'Attempt an adaptive goal.',
        goal: {
          schemaVersion: 1,
          objective: 'Research and decide.',
          summary: 'Observe evidence.',
          completionCriteria: 'Return an evidence-grounded answer.',
          requirements: [
            {
              id: 'requirement_research',
              description: 'Research the request.',
              capability: 'web_research',
              version: 1,
              condition: { kind: 'always' },
            },
          ],
          firstStep: {
            id: 'step_1',
            purpose: 'Research.',
            inputStepIds: [],
            capability: 'web_research',
            version: 1,
            arguments: { objective: 'Research this.' },
          },
        },
      },
      undefined,
      undefined,
      'third_party',
    );
    const result = await createEvaluateModelDecision(provider, undefined, {
      enabledCapabilities: [{ name: 'web_research', version: 1 }],
    })('Research and decide.');

    assert.equal(result.decision.kind, 'rejected');
    assert.doesNotMatch(provider.inputs[0]?.systemPrompt ?? '', /pursue_goal/u);
    assert.match(provider.inputs[0]?.systemPrompt ?? '', /invoke_capability/u);
    assert.doesNotMatch(
      JSON.stringify(provider.inputs[0]?.outputSchema),
      /pursue_goal/u,
    );
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

  void it('accepts reminders only in the code-configured owner time zone', async () => {
    const candidate = {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary: 'The owner asked to create a reminder.',
      capability: { name: 'personal_reminder_management', version: 1 },
      arguments: {
        action: 'create',
        message: 'Stand up',
        scheduledFor: '2026-08-26T08:05:00.000Z',
        timeZone: 'Africa/Johannesburg',
      },
    };
    const accepted = await createEvaluateModelDecision(
      new FakeModelProvider(candidate),
      () => 'decision_reminder',
      {
        enabledCapabilities: [
          { name: 'personal_reminder_management', version: 1 },
        ],
        ownerTimeZone: 'Africa/Johannesburg',
      },
    )('Remind me to stand up in five minutes.');
    assert.equal(accepted.decision.kind, 'approval_required');

    const rejected = await createEvaluateModelDecision(
      new FakeModelProvider({
        ...candidate,
        arguments: { ...candidate.arguments, timeZone: 'America/New_York' },
      }),
      () => 'decision_reminder_wrong_zone',
      {
        enabledCapabilities: [
          { name: 'personal_reminder_management', version: 1 },
        ],
        ownerTimeZone: 'Africa/Johannesburg',
      },
    )('Remind me to stand up in five minutes.');
    assert.deepEqual(rejected.decision, {
      kind: 'rejected',
      code: 'invalid_capability_arguments',
      message:
        'The proposed reminder does not preserve the configured owner time zone.',
    });
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

  void it('turns attachment-derived actions into an adaptive understand-then-act contract', async () => {
    const result = await createEvaluateModelDecision(
      new FakeModelProvider({
        schemaVersion: 1,
        kind: 'invoke_capability',
        decisionSummary: 'Create the task requested by the owner.',
        capability: { name: 'personal_task_management', version: 1 },
        arguments: { action: 'create', title: 'Draft release checklist' },
      }),
      () => 'decision_attachment_action',
      {
        enabledCapabilities: [
          { name: 'attachment_analysis', version: 1 },
          { name: 'personal_task_management', version: 1 },
        ],
      },
    )('Analyze this file and create a task from its most important finding.', {
      attachments: [
        {
          id: 'attachment_brief',
          kind: 'document',
          filename: 'brief.txt',
          mediaType: 'text/plain',
          byteLength: 42,
          sha256: 'a'.repeat(64),
        },
      ],
    });

    assert.equal(result.proposal?.kind, 'pursue_goal');
    assert.equal(result.decision.kind, 'adaptive_goal_planned');
    assert.equal(
      result.decision.plan.firstStep.capability,
      'attachment_analysis',
    );
    assert.deepEqual(
      result.decision.plan.requirements.map(({ capability }) => capability),
      ['attachment_analysis', 'personal_task_management'],
    );
  });

  void it('keeps a pure attachment-analysis request as one separately approved action', async () => {
    const result = await createEvaluateModelDecision(
      new FakeModelProvider({
        schemaVersion: 1,
        kind: 'invoke_capability',
        decisionSummary: 'Analyze the supplied file.',
        capability: { name: 'attachment_analysis', version: 1 },
        arguments: { objective: 'Summarize the supplied file.' },
      }),
      () => 'decision_attachment_only',
      {
        enabledCapabilities: [{ name: 'attachment_analysis', version: 1 }],
      },
    )('Summarize this file.', {
      attachments: [
        {
          id: 'attachment_brief',
          kind: 'document',
          filename: 'brief.txt',
          mediaType: 'text/plain',
          byteLength: 42,
          sha256: 'a'.repeat(64),
        },
      ],
    });

    assert.equal(result.proposal?.kind, 'invoke_capability');
    assert.equal(result.decision.kind, 'approval_required');
  });

  void it('rejects attachment action bundles that exceed the bounded goal instead of dropping outcomes', async () => {
    const result = await createEvaluateModelDecision(
      new FakeModelProvider({
        schemaVersion: 1,
        kind: 'invoke_capability',
        decisionSummary: 'Analyze the supplied file.',
        capability: { name: 'attachment_analysis', version: 1 },
        arguments: { objective: 'Analyze the supplied file.' },
      }),
      () => 'decision_attachment_overflow',
      {
        enabledCapabilities: [
          { name: 'attachment_analysis', version: 1 },
          { name: 'personal_task_management', version: 1 },
          { name: 'personal_reminder_management', version: 1 },
          { name: 'memory_management', version: 1 },
        ],
      },
    )(
      'Analyze this file, create a task, set a reminder, and remember the key finding.',
      {
        attachments: [
          {
            id: 'attachment_overflow',
            kind: 'document',
            filename: 'brief.txt',
            mediaType: 'text/plain',
            byteLength: 42,
            sha256: 'a'.repeat(64),
          },
        ],
      },
    );

    assert.deepEqual(result.decision, {
      kind: 'rejected',
      code: 'invalid_goal_plan',
      message:
        'The attachment request contains more downstream outcomes than Vera can preserve in one bounded goal.',
    });
  });
});
