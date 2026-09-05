import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryExecutionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-execution-store.ts';
import {
  externalSignalCampaignId,
  externalSignalProgress,
} from '../../../src/application/external-awareness/external-signal-resolution-service.ts';
import { ExternalSignalSchema } from '../../../src/domain/external-awareness/external-signal.ts';
import { TaskAggregateSchema } from '../../../src/domain/tasks/task-aggregate.ts';
import type { DevelopmentCampaign } from '../../../src/domain/development-campaigns/development-campaign.ts';

const observedAt = '2026-09-05T10:00:00.000Z';
const updatedAt = '2026-09-05T10:05:00.000Z';

const signal = ExternalSignalSchema.parse({
  schemaVersion: 1,
  version: 1,
  id: 'external_signal_resolution_test',
  principalId: 'owner_v1',
  routineId: 'routine_resolution_test',
  integrationId: 'github',
  connectionId: 'connection_resolution_test',
  project: { id: 'project_vera', displayName: 'Vera' },
  repository: { provider: 'github', owner: '4romgod', name: 'vera' },
  externalKey: 'pull:42:failed-checks',
  category: 'failed_check',
  title: 'Checks failed on #42',
  summary: 'quality-gate failed.',
  url: 'https://github.com/4romgod/vera/pull/42',
  occurredAt: observedAt,
  status: 'active',
  firstObservedAt: observedAt,
  lastObservedAt: observedAt,
});

function task(
  status: 'deciding' | 'awaiting_approval' | 'succeeded' | 'failed',
) {
  return TaskAggregateSchema.parse({
    schemaVersion: 1,
    version: 1,
    task: {
      id: `task_resolution_${status}`,
      requestKey: `resolution-${status}`,
      principalId: 'owner_v1',
      externalSignal: { id: signal.id, version: signal.version },
      message: 'Handle the failed check.',
      status:
        status === 'failed'
          ? 'failed'
          : status === 'succeeded'
            ? 'completed'
            : 'active',
      createdAt: observedAt,
      updatedAt,
    },
    run: {
      id: `run_resolution_${status}`,
      status,
      createdAt: observedAt,
      updatedAt,
      ...(status === 'failed'
        ? {
            failure: {
              code: 'internal_failure',
              message: 'Triage failed safely.',
            },
          }
        : {}),
    },
    events: [],
  });
}

function campaign(status: DevelopmentCampaign['status']): DevelopmentCampaign {
  return {
    id: 'campaign_resolution_test',
    status,
    updatedAt,
  } as DevelopmentCampaign;
}

void describe('external signal resolution projection', () => {
  void it('projects untriaged, triaging, approval, and failure states without mutating the signal', () => {
    assert.equal(
      externalSignalProgress(signal, null, null).status,
      'untriaged',
    );
    assert.equal(
      externalSignalProgress(signal, task('deciding'), null).status,
      'triaging',
    );
    assert.equal(
      externalSignalProgress(signal, task('awaiting_approval'), null).status,
      'action_approval_required',
    );
    const failed = externalSignalProgress(signal, task('failed'), null);
    assert.equal(failed.status, 'needs_attention');
    assert.equal(failed.summary, 'Triage failed safely.');
    assert.equal(signal.status, 'active');
  });

  void it('projects the repair lifecycle and waits for fresh source confirmation after success', () => {
    assert.equal(
      externalSignalProgress(
        signal,
        task('succeeded'),
        campaign('repair_awaiting_approval'),
      ).status,
      'repair_approval_required',
    );
    assert.equal(
      externalSignalProgress(signal, task('succeeded'), campaign('repairing'))
        .status,
      'repairing',
    );
    assert.equal(
      externalSignalProgress(signal, task('succeeded'), campaign('observing'))
        .status,
      'verifying',
    );
    assert.equal(
      externalSignalProgress(signal, task('succeeded'), campaign('succeeded'))
        .status,
      'awaiting_source_confirmation',
    );
  });

  void it('treats source reconciliation—not campaign success—as final resolution', () => {
    const resolved = ExternalSignalSchema.parse({
      ...signal,
      version: 2,
      status: 'resolved',
      resolvedAt: updatedAt,
      lastObservedAt: updatedAt,
    });
    const progress = externalSignalProgress(
      resolved,
      task('succeeded'),
      campaign('succeeded'),
    );
    assert.equal(progress.status, 'resolved');
    assert.equal(progress.updatedAt, updatedAt);
  });

  void it('finds the owner-scoped handling task by external signal identity', async () => {
    const store = new InMemoryExecutionStore();
    const aggregate = task('deciding');
    await store.create(aggregate);
    const pending = task('awaiting_approval');
    const newer = TaskAggregateSchema.parse({
      ...pending,
      task: {
        ...pending.task,
        updatedAt: '2026-09-05T10:06:00.000Z',
      },
      run: {
        ...pending.run,
        updatedAt: '2026-09-05T10:06:00.000Z',
      },
    });
    await store.create(newer);

    assert.equal(
      (
        await store.findLatestByExternalSignal(
          'owner_v1',
          signal.id,
          signal.version,
        )
      )?.task.id,
      newer.task.id,
    );
    assert.equal(
      await store.findLatestByExternalSignal(
        'owner_other',
        signal.id,
        signal.version,
      ),
      null,
    );
    assert.equal(
      await store.findLatestByExternalSignal('owner_v1', signal.id, 2),
      null,
    );
  });

  void it('extracts only an explicitly prepared software-delivery repair campaign', () => {
    const aggregate = task('succeeded');
    assert.equal(externalSignalCampaignId(aggregate), undefined);
    const prepared = {
      ...aggregate,
      run: {
        ...aggregate.run,
        output: {
          kind: 'software_delivery_management_result',
          result: {
            action: 'prepare_repair',
            campaign: { id: 'campaign_prepared' },
          },
        },
      },
    } as typeof aggregate;
    assert.equal(externalSignalCampaignId(prepared), 'campaign_prepared');
  });
});
