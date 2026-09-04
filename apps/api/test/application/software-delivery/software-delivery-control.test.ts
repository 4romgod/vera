import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSoftwareDeliveryControlService } from '../../../src/application/software-delivery/software-delivery-control-service.ts';
import {
  createSoftwareDeliveryContextSource,
  shouldAssembleSoftwareDeliveryContext,
} from '../../../src/application/software-delivery/software-delivery-context.ts';
import { validateSoftwareDeliveryReference } from '../../../src/application/model-decisions/resolve-software-delivery-reference.ts';
import type { DevelopmentCampaignLifecycle } from '../../../src/application/development-campaigns/development-campaign-lifecycle.ts';
import type { MissionLifecycle } from '../../../src/application/missions/mission-lifecycle.ts';
import type { DevelopmentCampaign } from '../../../src/domain/development-campaigns/development-campaign.ts';
import type { Mission } from '../../../src/domain/missions/mission.ts';
import type { DevelopmentCampaignStore } from '../../../src/ports/persistence/development-campaign-store.ts';
import type { MissionStore } from '../../../src/ports/persistence/mission-store.ts';

const now = '2026-09-05T12:00:00.000Z';
const earlier = '2026-09-04T12:00:00.000Z';
const headRevision = 'a'.repeat(40);

function mission(id = 'mission_alpha', status = 'executing'): Mission {
  return {
    id,
    status,
    approval: {
      effect: {
        objective: 'Deliver the owner-visible status page.',
        project: { id: 'project_vera', displayName: 'Vera' },
        campaign: { id: 'campaign_alpha' },
      },
    },
    createdAt: earlier,
    updatedAt: earlier,
  } as unknown as Mission;
}

function campaign(
  id = 'campaign_alpha',
  status = 'review_required',
): DevelopmentCampaign {
  return {
    id,
    status,
    publicationId: 'publication_alpha',
    approval: {
      effect: {
        objective: 'Deliver the owner-visible status page.',
        project: { id: 'project_vera', displayName: 'Vera' },
        repository: { owner: '4romgod', name: 'vera' },
        limits: { maxAttempts: 3 },
      },
    },
    attempts: [{}],
    pullRequest: {
      number: 42,
      url: 'https://github.com/4romgod/vera/pull/42',
      headRevision,
      observation: {
        checks: { total: 2, pending: 0, passed: 1, failed: 1 },
        reviewDecision: 'CHANGES_REQUESTED',
      },
    },
    createdAt: earlier,
    updatedAt: now,
  } as unknown as DevelopmentCampaign;
}

function preparedCampaign(): DevelopmentCampaign {
  return {
    ...campaign(),
    status: 'repair_awaiting_approval',
    repairs: [
      {
        schemaVersion: 1,
        id: 'repair_alpha',
        requestKey: 'invocation_alpha',
        status: 'pending',
        reason: 'pull_request_repair',
        effect: {
          attempt: 2,
          sourceRevision: headRevision,
          pullRequest: {
            number: 42,
            url: 'https://github.com/4romgod/vera/pull/42',
          },
          requestedChange: {
            objective: 'Repair the failed status check.',
            ticket: { reference: 'REPAIR', details: 'Repair failed checks.' },
          },
          delivery: {
            commitMessage: 'fix: repair failed status check',
            author: { name: 'Vera', email: 'vera@example.com' },
          },
          authority: {
            context: 'exact_pull_request_head',
            application: 'exact_generated_patch',
            verification: 'configured_commands',
            push: 'fast_forward_existing_pull_request_branch',
            forcePush: false,
            merge: false,
          },
        },
        evidence: {
          checkedAt: now,
          state: 'OPEN',
          headRevision,
          baseRevision: 'b'.repeat(40),
          checks: { total: 2, pending: 0, passed: 1, failed: 1 },
          reviewDecision: 'CHANGES_REQUESTED',
          mergeState: 'BLOCKED',
          failedChecks: [
            {
              name: 'check',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
            },
          ],
        },
        requestedAt: now,
      },
    ],
  };
}

function context() {
  return {
    schemaVersion: 1 as const,
    generatedAt: now,
    resources: [
      {
        kind: 'development_campaign' as const,
        id: 'campaign_alpha',
        status: 'review_required' as const,
        objective: 'Repair the status page.',
        project: { id: 'project_vera', displayName: 'Vera' },
        repository: { owner: '4romgod', name: 'vera' },
        attemptCount: 1,
        maxAttempts: 3,
        repairAvailable: true,
        pullRequest: {
          number: 42,
          url: 'https://github.com/4romgod/vera/pull/42',
          headRevision,
        },
        createdAt: earlier,
        updatedAt: now,
      },
      {
        kind: 'mission' as const,
        id: 'mission_alpha',
        status: 'executing' as const,
        objective: 'Deliver the status page.',
        project: { id: 'project_vera', displayName: 'Vera' },
        campaignId: 'campaign_alpha',
        createdAt: earlier,
        updatedAt: earlier,
      },
    ],
  };
}

void describe('conversational software delivery control', () => {
  void it('assembles a newest-first bounded owner catalog only for relevant requests', async () => {
    let missionLimit: number | undefined;
    let campaignLimit: number | undefined;
    const source = createSoftwareDeliveryContextSource({
      missions: {
        list: (_principalId: string, limit: number) => {
          missionLimit = limit;
          return Promise.resolve([mission()]);
        },
      } as unknown as MissionStore,
      campaigns: {
        list: (_principalId: string, limit: number) => {
          campaignLimit = limit;
          return Promise.resolve([campaign()]);
        },
      } as unknown as DevelopmentCampaignStore,
      clock: () => now,
    });

    const assembled = await source.assemble('owner_v1');

    assert.equal(missionLimit, 20);
    assert.equal(campaignLimit, 20);
    assert.deepEqual(
      assembled.resources.map(({ id }) => id),
      ['campaign_alpha', 'mission_alpha'],
    );
    assert.equal(
      shouldAssembleSoftwareDeliveryContext('Show my campaigns'),
      true,
    );
    assert.equal(shouldAssembleSoftwareDeliveryContext('How are you?'), false);
  });

  void it('lists and inspects owner resources without mutating delivery state', async () => {
    const service = createSoftwareDeliveryControlService({
      missions: {
        list: () =>
          Promise.resolve([mission(), mission('mission_done', 'succeeded')]),
        get: () => Promise.resolve(mission()),
      } as unknown as MissionLifecycle,
      campaigns: {
        list: () => Promise.resolve([campaign()]),
        get: () => Promise.resolve(campaign()),
      } as unknown as DevelopmentCampaignLifecycle,
    });

    const listed = await service.invoke({
      principalId: 'owner_v1',
      requestKey: 'list',
      arguments: { action: 'list', scope: 'active' },
    });
    const inspected = await service.invoke({
      principalId: 'owner_v1',
      requestKey: 'inspect',
      arguments: {
        action: 'inspect',
        target: { kind: 'development_campaign', id: 'campaign_alpha' },
      },
    });

    assert.equal(listed.action, 'list');
    assert.deepEqual(
      listed.resources.map(({ id }) => id),
      ['campaign_alpha', 'mission_alpha'],
    );
    assert.equal(inspected.action, 'inspect');
    assert.equal(inspected.resource.id, 'campaign_alpha');
    assert.match(inspected.summary, /Checks: 1 passed, 0 pending, 1 failed/u);
  });

  void it('bounds conversational list results after newest-first ordering', async () => {
    const missions = Array.from({ length: 41 }, (_, index) => ({
      ...mission(`mission_${String(index).padStart(2, '0')}`),
      updatedAt: new Date(Date.parse(earlier) + index * 1_000).toISOString(),
    }));
    const service = createSoftwareDeliveryControlService({
      missions: {
        list: () => Promise.resolve(missions),
      } as unknown as MissionLifecycle,
      campaigns: {
        list: () => Promise.resolve([]),
      } as unknown as DevelopmentCampaignLifecycle,
    });

    const listed = await service.invoke({
      principalId: 'owner_v1',
      requestKey: 'bounded-list',
      arguments: { action: 'list', scope: 'all' },
    });

    assert.equal(listed.action, 'list');
    assert.equal(listed.resources.length, 40);
    assert.equal(listed.resources.at(0)?.id, 'mission_40');
    assert.equal(listed.resources.at(-1)?.id, 'mission_01');
  });

  void it('prepares but does not approve or execute an exact-head repair', async () => {
    let request: Record<string, unknown> | undefined;
    const service = createSoftwareDeliveryControlService({
      missions: {} as MissionLifecycle,
      campaigns: {
        requestRepair: (input: Record<string, unknown>) => {
          request = input;
          return Promise.resolve(preparedCampaign());
        },
      } as unknown as DevelopmentCampaignLifecycle,
    });

    const result = await service.invoke({
      principalId: 'owner_v1',
      requestKey: 'invocation_alpha',
      arguments: { action: 'prepare_repair', campaignId: 'campaign_alpha' },
    });

    assert.deepEqual(request, {
      principalId: 'owner_v1',
      campaignId: 'campaign_alpha',
      requestKey: 'invocation_alpha',
    });
    assert.equal(result.action, 'prepare_repair');
    assert.equal(result.repair.status, 'pending');
    assert.equal(result.repair.effect.sourceRevision, headRevision);
    assert.equal(result.repair.effect.authority.forcePush, false);
    assert.equal(result.repair.effect.authority.merge, false);
  });

  void it('accepts exact PR and recent-conversation references but rejects a model-selected wrong kind', () => {
    assert.deepEqual(
      validateSoftwareDeliveryReference({
        arguments: {
          action: 'inspect',
          target: { kind: 'development_campaign', id: 'campaign_alpha' },
        },
        ownerMessage: 'Show me PR #42.',
        context: context(),
      }),
      { accepted: true },
    );
    assert.equal(
      validateSoftwareDeliveryReference({
        arguments: {
          action: 'inspect',
          target: { kind: 'development_campaign', id: 'campaign_alpha' },
        },
        ownerMessage: 'Show me the mission.',
        context: context(),
      }).accepted,
      false,
    );
    assert.deepEqual(
      validateSoftwareDeliveryReference({
        arguments: {
          action: 'prepare_repair',
          campaignId: 'campaign_alpha',
        },
        ownerMessage: 'Repair it.',
        context: context(),
        conversationContext: {
          manifest: {} as never,
          messages: [
            {
              messageId: 'message_prior',
              taskId: 'task_prior',
              role: 'vera',
              content: 'campaign_alpha needs review.',
            },
          ],
        },
      }),
      { accepted: true },
    );
  });

  void it('asks for clarification when the owner names more than one exact resource', () => {
    const result = validateSoftwareDeliveryReference({
      arguments: {
        action: 'inspect',
        target: { kind: 'mission', id: 'mission_alpha' },
      },
      ownerMessage: 'Compare mission_alpha with mission_beta.',
      context: {
        ...context(),
        resources: [
          ...context().resources,
          {
            ...context().resources[1],
            id: 'mission_beta',
          } as ReturnType<typeof context>['resources'][number],
        ],
      },
    });

    if (result.accepted) {
      assert.fail('Expected an ambiguous-reference clarification.');
    }
    assert.match(result.message, /more than one/u);
  });
});
