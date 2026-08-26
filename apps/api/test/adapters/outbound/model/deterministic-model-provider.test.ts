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
});
