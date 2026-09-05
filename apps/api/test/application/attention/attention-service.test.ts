import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryAttentionDecisionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-attention-decision-store.ts';
import { InMemoryRoutineStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-routine-store.ts';
import { InMemoryDevelopmentCampaignStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-development-campaign-store.ts';
import { InMemoryExecutionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import { InMemoryMissionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-mission-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createAttentionService } from '../../../src/application/attention/attention-service.ts';
import { InMemoryExternalSignalStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-external-signal-store.ts';
import { ExternalSignalSchema } from '../../../src/domain/external-awareness/external-signal.ts';
import { createNotificationService } from '../../../src/application/reminders/notification-service.ts';
import { TaskAggregateSchema } from '../../../src/domain/tasks/task-aggregate.ts';

void describe('attention service', () => {
  void it('projects active external signals into Today and the durable activity feed', async () => {
    const resources = new InMemoryOwnerResourceStore();
    const signals = new InMemoryExternalSignalStore();
    const signal = ExternalSignalSchema.parse({
      schemaVersion: 1,
      version: 1,
      id: `external_signal_${'a'.repeat(32)}`,
      principalId: 'owner_v1',
      routineId: 'routine_watch',
      integrationId: 'github',
      connectionId: 'connection_github',
      project: { id: 'project_vera', displayName: 'Vera' },
      repository: { provider: 'github', owner: '4romgod', name: 'vera' },
      externalKey: 'pull:42:failed-checks',
      category: 'failed_check',
      title: 'Checks failed on #42',
      summary: 'quality-gate failed.',
      url: 'https://github.com/4romgod/vera/pull/42',
      occurredAt: '2026-09-05T10:00:00.000Z',
      status: 'active',
      firstObservedAt: '2026-09-05T10:01:00.000Z',
      lastObservedAt: '2026-09-05T10:01:00.000Z',
    });
    await signals.upsert(signal);
    const executions = new InMemoryExecutionStore();
    await executions.create(
      TaskAggregateSchema.parse({
        schemaVersion: 1,
        version: 1,
        task: {
          id: 'task_signal_attention',
          requestKey: 'signal-attention',
          principalId: 'owner_v1',
          conversationId: 'conversation_signal_attention',
          messageId: 'message_signal_attention',
          projectId: signal.project.id,
          externalSignal: { id: signal.id, version: signal.version },
          message: 'Handle this signal.',
          status: 'completed',
          createdAt: '2026-09-05T10:01:30.000Z',
          updatedAt: '2026-09-05T10:01:40.000Z',
        },
        run: {
          id: 'run_signal_attention',
          status: 'succeeded',
          createdAt: '2026-09-05T10:01:30.000Z',
          updatedAt: '2026-09-05T10:01:40.000Z',
        },
        events: [],
      }),
    );
    const attention = createAttentionService({
      executions,
      resources,
      missions: new InMemoryMissionStore(),
      campaigns: new InMemoryDevelopmentCampaignStore(),
      decisions: new InMemoryAttentionDecisionStore(),
      routines: new InMemoryRoutineStore(),
      externalSignals: signals,
      clock: () => new Date('2026-09-05T10:02:00.000Z'),
    });
    const item = (await attention.getBriefing('owner_v1')).items.find(
      ({ target }) => target.kind === 'external_signal',
    );
    assert.equal(item?.reason, 'external_check_failed');
    assert.deepEqual(item.target, {
      kind: 'external_signal',
      externalSignalId: signal.id,
      routineId: signal.routineId,
      url: signal.url,
      taskId: 'task_signal_attention',
      runId: 'run_signal_attention',
      conversationId: 'conversation_signal_attention',
    });
    const activity = await createNotificationService({
      store: resources,
      externalSignals: signals,
    }).list('owner_v1');
    const notification = activity.notifications[0];
    assert.ok(notification);
    assert.equal(notification.message, signal.title);
    assert.ok('externalSignalId' in notification);
    assert.equal(notification.externalSignalId, signal.id);
  });

  void it('prioritizes overdue work and keeps dispositions scoped to an exact source generation', async () => {
    const resources = new InMemoryOwnerResourceStore();
    const decisions = new InMemoryAttentionDecisionStore();
    let now = new Date('2026-09-04T12:00:00.000Z');
    const attention = createAttentionService({
      executions: new InMemoryExecutionStore(),
      resources,
      missions: new InMemoryMissionStore(),
      campaigns: new InMemoryDevelopmentCampaignStore(),
      decisions,
      routines: new InMemoryRoutineStore(),
      clock: () => now,
    });
    await resources.createPersonalTask({
      schemaVersion: 1,
      id: 'personal_task_attention_unit',
      principalId: 'owner_v1',
      title: 'Review the release',
      dueAt: '2026-09-02T12:00:00.000Z',
      status: 'open',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
      creationInvocationId: 'invocation_attention_create',
      lastMutation: {
        invocationId: 'invocation_attention_create',
        orderKey: '2026-09-01T12:00:00.000Z\u0000invocation_attention_create',
      },
    });

    const initial = await attention.getBriefing('owner_v1');
    const initialItem = initial.items[0];
    assert.ok(initialItem);
    assert.equal(initialItem.priority, 'urgent');
    assert.equal(initialItem.reason, 'task_overdue');
    const firstItemId = initialItem.id;

    const dismissed = await attention.decide({
      principalId: 'owner_v1',
      attentionItemId: firstItemId,
      requestKey: 'attention-unit-dismiss',
      request: { decision: 'dismiss' },
    });
    assert.equal(dismissed.items.length, 0);
    assert.equal(dismissed.dismissedItems[0]?.id, firstItemId);
    const restored = await attention.decide({
      principalId: 'owner_v1',
      attentionItemId: firstItemId,
      requestKey: 'attention-unit-restore',
      request: { decision: 'restore' },
    });
    assert.equal(restored.items[0]?.id, firstItemId);

    await resources.setPersonalTaskStatus({
      principalId: 'owner_v1',
      taskId: 'personal_task_attention_unit',
      status: 'completed',
      invocationId: 'invocation_attention_complete',
      mutationAt: '2026-09-04T12:01:00.000Z',
      recovery: false,
    });
    await resources.setPersonalTaskStatus({
      principalId: 'owner_v1',
      taskId: 'personal_task_attention_unit',
      status: 'open',
      invocationId: 'invocation_attention_reopen',
      mutationAt: '2026-09-04T12:02:00.000Z',
      recovery: false,
    });
    now = new Date('2026-09-04T12:03:00.000Z');
    const reopened = await attention.getBriefing('owner_v1');
    assert.equal(reopened.items.length, 1);
    assert.notEqual(reopened.items[0]?.id, firstItemId);
    const replay = await attention.decide({
      principalId: 'owner_v1',
      attentionItemId: firstItemId,
      requestKey: 'attention-unit-dismiss',
      request: { decision: 'dismiss' },
    });
    assert.equal(replay.items[0]?.id, reopened.items[0]?.id);
  });

  void it('automatically reactivates an expired snooze', async () => {
    const resources = new InMemoryOwnerResourceStore();
    let now = new Date('2026-09-04T12:00:00.000Z');
    const attention = createAttentionService({
      executions: new InMemoryExecutionStore(),
      resources,
      missions: new InMemoryMissionStore(),
      campaigns: new InMemoryDevelopmentCampaignStore(),
      decisions: new InMemoryAttentionDecisionStore(),
      routines: new InMemoryRoutineStore(),
      clock: () => now,
    });
    await resources.createPersonalTask({
      schemaVersion: 1,
      id: 'personal_task_attention_snooze',
      principalId: 'owner_v1',
      title: 'Check the briefing',
      status: 'open',
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:00.000Z',
      creationInvocationId: 'invocation_attention_snooze_create',
      lastMutation: {
        invocationId: 'invocation_attention_snooze_create',
        orderKey:
          '2026-09-04T10:00:00.000Z\u0000invocation_attention_snooze_create',
      },
    });
    const item = (await attention.getBriefing('owner_v1')).items[0];
    assert.ok(item);
    await attention.decide({
      principalId: 'owner_v1',
      attentionItemId: item.id,
      requestKey: 'attention-unit-snooze',
      request: {
        decision: 'snooze',
        snoozedUntil: '2026-09-04T13:00:00.000Z',
      },
    });
    now = new Date('2026-09-04T13:00:01.000Z');
    const reactivated = await attention.getBriefing('owner_v1');
    assert.equal(reactivated.items[0]?.id, item.id);
    assert.equal(reactivated.snoozedItems.length, 0);
  });

  void it('surfaces a newly urgent generation after an earlier priority was dismissed', async () => {
    const resources = new InMemoryOwnerResourceStore();
    let now = new Date('2026-09-04T12:00:00.000Z');
    const attention = createAttentionService({
      executions: new InMemoryExecutionStore(),
      resources,
      missions: new InMemoryMissionStore(),
      campaigns: new InMemoryDevelopmentCampaignStore(),
      decisions: new InMemoryAttentionDecisionStore(),
      routines: new InMemoryRoutineStore(),
      clock: () => now,
    });
    await resources.createPersonalTask({
      schemaVersion: 1,
      id: 'personal_task_attention_escalation',
      principalId: 'owner_v1',
      title: 'Resolve the escalation',
      dueAt: '2026-09-04T11:00:00.000Z',
      status: 'open',
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:00.000Z',
      creationInvocationId: 'invocation_attention_escalation_create',
      lastMutation: {
        invocationId: 'invocation_attention_escalation_create',
        orderKey:
          '2026-09-04T10:00:00.000Z\u0000invocation_attention_escalation_create',
      },
    });
    const high = (await attention.getBriefing('owner_v1')).items[0];
    assert.ok(high);
    assert.equal(high.priority, 'high');
    await attention.decide({
      principalId: 'owner_v1',
      attentionItemId: high.id,
      requestKey: 'attention-unit-escalation-dismiss',
      request: { decision: 'dismiss' },
    });

    now = new Date('2026-09-05T12:00:01.000Z');
    const urgent = (await attention.getBriefing('owner_v1')).items[0];
    assert.ok(urgent);
    assert.equal(urgent.priority, 'urgent');
    assert.notEqual(urgent.id, high.id);
  });
});
