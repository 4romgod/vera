import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LiveVoiceSessionSchema } from '../../src/domain/voice/live-voice-session.ts';

function session() {
  return {
    schemaVersion: 1 as const,
    version: 3,
    id: 'voice_session_contract',
    principalId: 'owner_v1',
    requestKey: 'voice-session-contract',
    takeoverRequested: false,
    activeSlot: 1 as const,
    conversationId: 'conversation_contract',
    roomName: 'vera_voice_contract',
    participantIdentity: 'vera_owner_contract',
    status: 'active' as const,
    expiresAt: '2026-09-05T23:30:00.000Z',
    startedAt: '2026-09-05T23:00:00.000Z',
    updatedAt: '2026-09-05T23:01:00.000Z',
    connectedAt: '2026-09-05T23:00:01.000Z',
    turns: [
      {
        id: 'voice_turn_contract',
        sequence: 1,
        status: 'settled' as const,
        transcript: 'What is Vera?',
        messageId: 'message_contract',
        taskId: 'task_contract',
        runId: 'run_contract',
        createdAt: '2026-09-05T23:00:10.000Z',
        updatedAt: '2026-09-05T23:00:20.000Z',
      },
    ],
    deliveries: [
      {
        id: 'speech_delivery_contract',
        turnId: 'voice_turn_contract',
        kind: 'response' as const,
        state: 'played' as const,
        content: 'Vera coordinates your digital work.',
        messageId: 'message_reply_contract',
        preparedAt: '2026-09-05T23:00:21.000Z',
        releasedAt: '2026-09-05T23:00:22.000Z',
        settledAt: '2026-09-05T23:00:30.000Z',
      },
    ],
  };
}

void describe('live voice session aggregate', () => {
  void it('accepts a coherent active session with a settled turn', () => {
    assert.equal(LiveVoiceSessionSchema.parse(session()).status, 'active');
  });

  void it('rejects terminal-state, turn, and delivery contradictions', () => {
    assert.equal(
      LiveVoiceSessionSchema.safeParse({
        ...session(),
        status: 'ended',
      }).success,
      false,
    );
    assert.equal(
      LiveVoiceSessionSchema.safeParse({
        ...session(),
        turns: [{ ...session().turns[0], sequence: 2 }],
      }).success,
      false,
    );
    assert.equal(
      LiveVoiceSessionSchema.safeParse({
        ...session(),
        deliveries: [
          {
            ...session().deliveries[0],
            turnId: 'voice_turn_unknown',
            settledAt: undefined,
          },
        ],
      }).success,
      false,
    );
  });

  void it('keeps delivery headroom above the two-per-turn current maximum', () => {
    const deliveries = Array.from({ length: 201 }, (_, index) => ({
      id: `speech_delivery_capacity_${String(index)}`,
      turnId: 'voice_turn_contract',
      kind: 'response' as const,
      state: 'prepared' as const,
      content: 'Bounded delivery.',
      preparedAt: '2026-09-05T23:00:21.000Z',
    }));
    assert.equal(
      LiveVoiceSessionSchema.safeParse({ ...session(), deliveries }).success,
      true,
    );
    assert.equal(
      LiveVoiceSessionSchema.safeParse({
        ...session(),
        deliveries: [
          ...deliveries,
          ...Array.from({ length: 100 }, (_, index) => ({
            ...deliveries[0],
            id: `speech_delivery_overflow_${String(index)}`,
          })),
        ],
      }).success,
      false,
    );
  });
});
