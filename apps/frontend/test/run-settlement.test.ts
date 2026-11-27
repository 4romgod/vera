import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isRunSettledForConversation } from '../src/components/assistant/run-settlement.ts';

const conversationId = 'conversation_1';

void describe('run settlement', () => {
  void it('keeps following a clarification until its question is projected', () => {
    assert.equal(
      isRunSettledForConversation({
        runStatus: 'awaiting_clarification',
        conversationId,
        conversationReply: {
          status: 'pending',
          messageId: 'message_question',
          createdAt: '2026-09-08T10:00:00.000Z',
        },
      }),
      false,
    );
    assert.equal(
      isRunSettledForConversation({
        runStatus: 'awaiting_clarification',
        conversationId,
      }),
      false,
    );
    assert.equal(
      isRunSettledForConversation({
        runStatus: 'awaiting_clarification',
        conversationId,
        conversationReply: {
          status: 'projected',
          messageId: 'message_question',
          createdAt: '2026-09-08T10:00:00.000Z',
          projectedAt: '2026-09-08T10:00:01.000Z',
        },
      }),
      true,
    );
  });

  void it('stops at approvals and at terminal runs with a visible reply', () => {
    assert.equal(
      isRunSettledForConversation({
        runStatus: 'awaiting_approval',
        conversationId,
      }),
      true,
    );
    assert.equal(
      isRunSettledForConversation({ runStatus: 'succeeded', conversationId }),
      false,
    );
    assert.equal(isRunSettledForConversation({ runStatus: 'failed' }), true);
    assert.equal(isRunSettledForConversation({ runStatus: 'deciding' }), false);
  });
});
