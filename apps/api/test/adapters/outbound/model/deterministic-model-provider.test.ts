import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeterministicModelProvider } from '../../../../src/adapters/outbound/model/deterministic-model-provider.ts';

void describe('deterministic model provider', () => {
  void it('treats capability words in reminder content as data, not extra authority', async () => {
    const provider = new DeterministicModelProvider();
    const generation = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage:
          'Remind me to verify, plan, and fix restart-safe scheduling at 2035-08-26T10:00:00.000Z',
        temporalContext: {
          currentTime: '2026-08-26T10:00:00.000Z',
          ownerTimeZone: 'Africa/Johannesburg',
        },
      }),
      outputSchema: {
        capabilities: [
          'personal_reminder_management',
          'web_research',
          'development_planning',
          'software_change',
          'execute_goal',
        ],
      },
    });

    assert.deepEqual(generation.candidate, {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary:
        'The owner requested an action against durable reminders.',
      capability: { name: 'personal_reminder_management', version: 1 },
      arguments: {
        action: 'create',
        message:
          'Remind me to verify, plan, and fix restart-safe scheduling at 2035-08-26T10:00:00.000Z',
        scheduledFor: '2035-08-26T10:00:00.000Z',
        timeZone: 'Africa/Johannesburg',
      },
    });
  });

  void it('resolves adaptive requirements from observation capability identity', async () => {
    const provider = new DeterministicModelProvider();
    const generation = await provider.generateStructured({
      purpose: 'goal_continuation',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage: 'Research this and remind me if confirmed.',
        nextStepId: 'step_3',
        temporalContext: {
          currentTime: '2026-08-26T10:00:00.000Z',
          ownerTimeZone: 'Africa/Johannesburg',
        },
        requirements: [
          {
            id: 'requirement_research',
            capability: 'web_research',
            version: 1,
            condition: { kind: 'always' },
          },
          {
            id: 'requirement_reminder',
            capability: 'personal_reminder_management',
            version: 1,
            condition: { kind: 'evidence_dependent' },
          },
        ],
        observations: [
          {
            stepId: 'step_1',
            capability: { name: 'web_research', version: 1 },
            artifact: { type: 'research_report' },
          },
          {
            stepId: 'step_2',
            capability: {
              name: 'personal_reminder_management',
              version: 1,
            },
            artifact: { type: 'personal_reminder_result' },
          },
        ],
      }),
      outputSchema: { personal_reminder_management: true },
    });

    assert.deepEqual(
      (
        generation.candidate as {
          requirementResolutions: { evidenceStepIds: string[] }[];
        }
      ).requirementResolutions.map(({ evidenceStepIds }) => evidenceStepIds),
      [['step_1'], ['step_2']],
    );
  });

  void it('selects deterministic software-delivery references by kind and pull-request number', async () => {
    const provider = new DeterministicModelProvider();
    const softwareDeliveryContext = [
      {
        kind: 'development_campaign',
        id: 'campaign_latest',
        repairAvailable: true,
        pullRequest: { number: 51 },
      },
      { kind: 'mission', id: 'mission_latest' },
      {
        kind: 'development_campaign',
        id: 'campaign_pr_42',
        repairAvailable: true,
        pullRequest: { number: 42 },
      },
    ];
    const outputSchema = {
      capabilities: [
        'software_delivery_management',
        'software_delivery_repair',
      ],
    };

    const latestMission = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage: 'Inspect my latest mission.',
        softwareDeliveryContext,
      }),
      outputSchema,
    });
    const pullRequestRepair = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage: 'Repair failed checks on PR #42.',
        softwareDeliveryContext,
      }),
      outputSchema,
    });

    assert.deepEqual(latestMission.candidate, {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary:
        'The owner requested deterministic control of an existing software delivery.',
      capability: { name: 'software_delivery_management', version: 1 },
      arguments: {
        action: 'inspect',
        target: { kind: 'mission', id: 'mission_latest' },
      },
    });
    assert.deepEqual(pullRequestRepair.candidate, {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary:
        'The owner requested deterministic control of an existing software delivery.',
      capability: { name: 'software_delivery_repair', version: 1 },
      arguments: {
        action: 'prepare_repair',
        campaignId: 'campaign_pr_42',
      },
    });
  });

  void it('routes selected-project GitHub issue requests through work-item management', async () => {
    const provider = new DeterministicModelProvider();
    const outputSchema = { capabilities: ['work_item_management'] };
    const create = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage:
          'Create a GitHub issue: Add connection health to readiness',
        selectedProject: { id: 'project_vera', displayName: 'Vera' },
      }),
      outputSchema,
    });
    const list = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage: 'List closed GitHub issues',
        selectedProject: { id: 'project_vera', displayName: 'Vera' },
      }),
      outputSchema,
    });

    assert.deepEqual(create.candidate, {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary:
        'The owner requested an action against work items in the selected project.',
      capability: { name: 'work_item_management', version: 1 },
      arguments: {
        action: 'create',
        objective: 'Create a GitHub issue: Add connection health to readiness',
        project: { name: 'Vera' },
        issue: {
          title: 'Add connection health to readiness',
          body: '',
          labels: [],
        },
      },
    });
    assert.deepEqual((list.candidate as { arguments: unknown }).arguments, {
      action: 'list',
      objective: 'List closed GitHub issues',
      project: { name: 'Vera' },
      state: 'closed',
      limit: 20,
    });
  });

  void it('drafts a selected-project GitHub watch without external write authority', async () => {
    const provider = new DeterministicModelProvider();
    const result = await provider.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: 'test',
      message: JSON.stringify({
        ownerMessage:
          'Watch GitHub review requests and failed checks every 20 minutes',
        selectedProject: { id: 'project_vera', displayName: 'Vera' },
      }),
      outputSchema: { capabilities: ['routine_management'] },
    });
    assert.deepEqual(result.candidate, {
      schemaVersion: 1,
      kind: 'invoke_capability',
      decisionSummary:
        'The owner requested management of a recurring standing instruction.',
      capability: { name: 'routine_management', version: 1 },
      arguments: {
        action: 'create',
        routine: {
          title: 'Watch Vera on GitHub',
          schedule: { kind: 'interval', minutes: 20 },
          action: {
            kind: 'integration_awareness',
            integrationId: 'github',
            projectId: 'project_vera',
            categories: ['review_requested', 'failed_check'],
          },
        },
      },
    });
  });
});
