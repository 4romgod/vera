import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createConversationService } from '../../../src/application/conversations/conversation-service.ts';
import { ResourceError } from '../../../src/application/shared/resource-error.ts';

const createdAt = '2026-09-06T12:00:00.000Z';
const removedAt = '2026-09-06T12:05:00.000Z';

void describe('conversation removal', () => {
  void it('hides a removed conversation while preserving late Vera projection', async () => {
    const store = new InMemoryOwnerResourceStore();
    let now = createdAt;
    const service = createConversationService({
      store,
      clock: () => now,
      createId: (prefix) => `${prefix}_test`,
    });
    const conversation = await service.createConversation({
      principalId: 'owner_v1',
      creationKey: 'conversation-create',
      title: 'Disposable conversation',
    });
    await service.appendOwnerMessage({
      principalId: 'owner_v1',
      conversationId: conversation.id,
      requestKey: 'owner-message',
      content: 'Finish this reply before removal.',
    });

    now = removedAt;
    const deletion = await service.removeConversation(
      'owner_v1',
      conversation.id,
    );

    assert.deepEqual(deletion, {
      schemaVersion: 1,
      id: conversation.id,
      status: 'removed',
      removedAt,
    });
    assert.deepEqual(await service.listConversations('owner_v1'), []);
    await assert.rejects(
      service.getConversation('owner_v1', conversation.id),
      (error: unknown) =>
        error instanceof ResourceError &&
        error.code === 'conversation_not_found',
    );
    await assert.rejects(
      service.appendOwnerMessage({
        principalId: 'owner_v1',
        conversationId: conversation.id,
        requestKey: 'late-owner-message',
        content: 'This must not be accepted.',
      }),
      (error: unknown) =>
        error instanceof ResourceError &&
        error.code === 'conversation_not_found',
    );

    const lateReply = await store.appendMessage('owner_v1', conversation.id, {
      id: 'message_late_reply',
      requestKey: 'vera-reply:task_test',
      role: 'vera',
      content: 'The already-running work completed safely.',
      createdAt: '2026-09-06T12:06:00.000Z',
    });
    assert.equal(lateReply.created, true);
    assert.equal(lateReply.conversation.status, 'removed');
    assert.equal(
      lateReply.conversation.messages.at(-1)?.id,
      'message_late_reply',
    );

    assert.deepEqual(
      await service.removeConversation('owner_v1', conversation.id),
      deletion,
    );
  });

  void it('does not disclose whether another principal owns a conversation', async () => {
    const store = new InMemoryOwnerResourceStore();
    const service = createConversationService({
      store,
      clock: () => createdAt,
      createId: (prefix) => `${prefix}_private`,
    });
    const conversation = await service.createConversation({
      principalId: 'owner_v1',
      creationKey: 'private-create',
    });

    await assert.rejects(
      service.removeConversation('other_owner', conversation.id),
      (error: unknown) =>
        error instanceof ResourceError &&
        error.code === 'conversation_not_found',
    );
  });
});
