import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createConversationService } from '../../../src/application/conversations/conversation-service.ts';
import { createExternalSignalTriageService } from '../../../src/application/external-awareness/external-signal-triage-service.ts';
import { ExternalSignalSchema } from '../../../src/domain/external-awareness/external-signal.ts';
import type { TaskLifecycle } from '../../../src/application/tasks/task-lifecycle.ts';
import type { TaskAggregate } from '../../../src/domain/tasks/task-aggregate.ts';

void describe('external signal triage', () => {
  void it('creates one project-scoped conversation task and replays safely', async () => {
    const resources = new InMemoryOwnerResourceStore();
    await resources.createProject({
      schemaVersion: 1,
      id: 'project_triage_test',
      principalId: 'owner_v1',
      registrationKey: 'project-key',
      displayName: 'Vera',
      normalizedName: 'vera',
      source: { kind: 'local_git', rootPath: '/tmp/vera' },
      status: 'active',
      createdAt: '2026-09-05T10:00:00.000Z',
      updatedAt: '2026-09-05T10:00:00.000Z',
    });
    const signal = ExternalSignalSchema.parse({
      schemaVersion: 1,
      version: 3,
      id: 'external_signal_triage_test',
      principalId: 'owner_v1',
      routineId: 'routine_triage_test',
      integrationId: 'github',
      connectionId: 'connection_triage_test',
      project: { id: 'project_triage_test', displayName: 'Vera' },
      repository: { provider: 'github', owner: '4romgod', name: 'vera' },
      externalKey: 'pull:42:failed-checks',
      category: 'failed_check',
      title: 'Untrusted title',
      summary: 'Untrusted summary',
      url: 'https://github.com/4romgod/vera/pull/42',
      occurredAt: '2026-09-05T10:00:00.000Z',
      status: 'active',
      firstObservedAt: '2026-09-05T10:01:00.000Z',
      lastObservedAt: '2026-09-05T10:01:00.000Z',
    });
    let submitted: Parameters<TaskLifecycle['submit']>[0] | undefined;
    const aggregate = {
      schemaVersion: 1,
      version: 1,
      task: {
        id: 'task_triage_test',
        requestKey: 'message_triage_test',
        principalId: 'owner_v1',
        projectId: signal.project.id,
        conversationId: 'conversation_triage_test',
        messageId: 'message_triage_test',
        externalSignal: { id: signal.id, version: signal.version },
        message: 'objective',
        status: 'active',
        createdAt: '2026-09-05T10:02:00.000Z',
        updatedAt: '2026-09-05T10:02:00.000Z',
      },
      run: {
        id: 'run_triage_test',
        status: 'deciding',
        createdAt: '2026-09-05T10:02:00.000Z',
        updatedAt: '2026-09-05T10:02:00.000Z',
      },
      events: [],
    } as TaskAggregate;
    const tasks = {
      submit: (input: Parameters<TaskLifecycle['submit']>[0]) => {
        submitted = input;
        aggregate.task.requestKey = input.requestKey;
        aggregate.task.conversationId = input.conversationId;
        aggregate.task.messageId = input.messageId;
        aggregate.task.message = input.message;
        return Promise.resolve(aggregate);
      },
      getTask: () => Promise.resolve(aggregate),
    } as unknown as TaskLifecycle;
    const service = createExternalSignalTriageService({
      awareness: { get: () => Promise.resolve(signal) },
      conversations: createConversationService({
        store: resources,
        clock: () => '2026-09-05T10:02:00.000Z',
        createId: (prefix) => `${prefix}_triage_test`,
      }),
      tasks,
    });

    const first = await service.handle({
      principalId: 'owner_v1',
      signalId: signal.id,
      requestKey: 'phone-tap',
    });
    const replay = await service.handle({
      principalId: 'owner_v1',
      signalId: signal.id,
      requestKey: 'phone-tap',
    });

    assert.equal(first.task.id, replay.task.id);
    assert.ok(submitted);
    assert.equal(submitted.externalSignalId, signal.id);
    assert.equal(submitted.projectId, signal.project.id);
    assert.doesNotMatch(submitted.message, /Untrusted/u);
    const conversations = await resources.listConversations('owner_v1');
    assert.equal(conversations.length, 1);
  });
});
