import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { assembleConversationContext } from '../../../src/application/conversations/assemble-conversation-context.ts';
import { assertConversationContextIntegrity } from '../../../src/application/conversations/validate-conversation-context.ts';
import type { ConversationContextBundle } from '../../../src/domain/conversations/conversation-context.ts';
import type {
  Conversation,
  ConversationMessage,
} from '../../../src/domain/conversations/conversation.ts';

const occurredAt = '2026-08-25T08:00:00.000Z';

function message(input: {
  id: string;
  role: 'owner' | 'vera';
  content: string;
  taskId?: string;
  projectId?: string;
}): ConversationMessage {
  return {
    id: input.id,
    requestKey: `request-${input.id}`,
    role: input.role,
    content: input.content,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    createdAt: occurredAt,
  };
}

function conversation(messages: ConversationMessage[]): Conversation {
  return {
    schemaVersion: 1,
    id: 'conversation_test',
    principalId: 'owner_v1',
    creationKey: 'conversation-test',
    title: 'Test conversation',
    status: 'active',
    messages,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

void describe('conversation context assembly', () => {
  void it('includes only prior complete turns in the exact project scope', () => {
    const owner = message({
      id: 'message_owner_a',
      role: 'owner',
      content: 'Plan project A.',
      taskId: 'task_a',
      projectId: 'project_a',
    });
    const vera = message({
      id: 'message_vera_a',
      role: 'vera',
      content: 'Project A plan is ready.',
      taskId: 'task_a',
      projectId: 'project_a',
    });
    const current = message({
      id: 'message_current',
      role: 'owner',
      content: 'Refine it.',
      projectId: 'project_a',
    });
    const result = assembleConversationContext({
      conversation: conversation([
        owner,
        vera,
        message({
          id: 'message_owner_b',
          role: 'owner',
          content: 'Plan project B.',
          taskId: 'task_b',
          projectId: 'project_b',
        }),
        message({
          id: 'message_vera_b',
          role: 'vera',
          content: 'Project B plan is ready.',
          taskId: 'task_b',
          projectId: 'project_b',
        }),
        message({
          id: 'message_incomplete',
          role: 'owner',
          content: 'Still running.',
          taskId: 'task_incomplete',
          projectId: 'project_a',
        }),
        current,
      ]),
      throughMessageId: current.id,
      projectId: 'project_a',
      limits: { maxMessages: 20, maxCharacters: 40_000 },
    });

    assert.deepEqual(
      result.messages.map(({ messageId, taskId, role, content }) => ({
        messageId,
        taskId,
        role,
        content,
      })),
      [
        {
          messageId: owner.id,
          taskId: 'task_a',
          role: 'owner',
          content: owner.content,
        },
        {
          messageId: vera.id,
          taskId: 'task_a',
          role: 'vera',
          content: vera.content,
        },
      ],
    );
    assert.deepEqual(result.manifest.scope, {
      kind: 'project',
      projectId: 'project_a',
    });
    assert.deepEqual(result.manifest.exclusions, {
      differentScope: 2,
      incompleteTurns: 1,
      limits: 0,
    });
    assert.equal(
      result.manifest.entries[0]?.sha256,
      createHash('sha256').update(owner.content).digest('hex'),
    );
  });

  void it('keeps the most recent whole turns within configured limits', () => {
    const messages: ConversationMessage[] = [];
    for (let turn = 1; turn <= 3; turn += 1) {
      messages.push(
        message({
          id: `message_owner_${String(turn)}`,
          role: 'owner',
          content: `owner ${String(turn)}`,
          taskId: `task_${String(turn)}`,
        }),
        message({
          id: `message_vera_${String(turn)}`,
          role: 'vera',
          content: `vera ${String(turn)}`,
          taskId: `task_${String(turn)}`,
        }),
      );
    }
    const current = message({
      id: 'message_current',
      role: 'owner',
      content: 'What next?',
    });
    messages.push(current);

    const result = assembleConversationContext({
      conversation: conversation(messages),
      throughMessageId: current.id,
      limits: { maxMessages: 2, maxCharacters: 1_000 },
    });

    assert.deepEqual(
      result.messages.map((candidate) => candidate.content),
      ['owner 3', 'vera 3'],
    );
    assert.equal(result.manifest.exclusions.limits, 4);
    assert.equal(result.manifest.totalMessages, 2);
  });

  void it('validates every identity, hash, size, total, scope, and complete-turn invariant', () => {
    const owner = message({
      id: 'message_integrity_owner',
      role: 'owner',
      content: 'Owner text.',
      taskId: 'task_integrity',
      projectId: 'project_a',
    });
    const vera = message({
      id: 'message_integrity_vera',
      role: 'vera',
      content: 'Vera text.',
      taskId: 'task_integrity',
      projectId: 'project_a',
    });
    const current = message({
      id: 'message_integrity_current',
      role: 'owner',
      content: 'Continue.',
      projectId: 'project_a',
    });
    const sourceConversation = conversation([owner, vera, current]);
    const context = assembleConversationContext({
      conversation: sourceConversation,
      throughMessageId: current.id,
      projectId: 'project_a',
      limits: { maxMessages: 20, maxCharacters: 40_000 },
    });
    const expected = {
      conversationId: 'conversation_test',
      throughMessageId: current.id,
      projectId: 'project_a',
      conversation: sourceConversation,
    };
    assert.doesNotThrow(() =>
      assertConversationContextIntegrity(context, expected),
    );

    const corruptions: ((bundle: ConversationContextBundle) => void)[] = [
      (bundle) => {
        bundle.manifest.conversationId = 'conversation_other';
      },
      (bundle) => {
        const entry = bundle.manifest.entries[0];
        assert.ok(entry);
        entry.sha256 = '0'.repeat(64);
      },
      (bundle) => {
        const entry = bundle.manifest.entries[0];
        assert.ok(entry);
        entry.characters += 1;
      },
      (bundle) => {
        bundle.manifest.totalCharacters += 1;
      },
      (bundle) => {
        const entry = bundle.manifest.entries[1];
        const historyMessage = bundle.messages[1];
        assert.ok(entry && historyMessage);
        entry.role = 'owner';
        historyMessage.role = 'owner';
      },
      (bundle) => {
        bundle.manifest.exclusions.differentScope = 2;
      },
    ];
    for (const corrupt of corruptions) {
      const corrupted = structuredClone(context);
      corrupt(corrupted);
      assert.throws(() =>
        assertConversationContextIntegrity(corrupted, expected),
      );
    }
  });
});
