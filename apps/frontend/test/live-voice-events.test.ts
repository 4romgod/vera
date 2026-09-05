import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLiveVoiceEvent } from '../src/voice/live-voice-events.ts';

const encoder = new TextEncoder();

void describe('live voice transport events', () => {
  void it('accepts the bounded versioned delivery contract', () => {
    assert.deepEqual(
      parseLiveVoiceEvent(
        encoder.encode(
          JSON.stringify({
            schemaVersion: 1,
            type: 'speech_delivery',
            sessionId: 'voice_session_test',
            turnId: 'voice_turn_test',
            deliveryId: 'speech_delivery_test',
            kind: 'response',
            text: 'Ready.',
          }),
        ),
      ),
      {
        schemaVersion: 1,
        type: 'speech_delivery',
        sessionId: 'voice_session_test',
        turnId: 'voice_turn_test',
        deliveryId: 'speech_delivery_test',
        kind: 'response',
        text: 'Ready.',
      },
    );
  });

  void it('rejects malformed, unknown, and unbounded transport data', () => {
    assert.equal(parseLiveVoiceEvent(encoder.encode('{')), null);
    assert.equal(
      parseLiveVoiceEvent(
        encoder.encode(
          JSON.stringify({
            schemaVersion: 1,
            type: 'unknown',
            sessionId: 'voice_session_test',
          }),
        ),
      ),
      null,
    );
    assert.equal(
      parseLiveVoiceEvent(
        encoder.encode(
          JSON.stringify({
            schemaVersion: 1,
            type: 'speech_delivery',
            sessionId: 'voice_session_test',
            turnId: 'voice_turn_test',
            deliveryId: 'speech_delivery_test',
            kind: 'acknowledgement',
            text: 'Dead protocol member.',
          }),
        ),
      ),
      null,
    );
    assert.equal(
      parseLiveVoiceEvent(
        encoder.encode(
          JSON.stringify({
            schemaVersion: 1,
            type: 'transcript',
            sessionId: 'voice_session_test',
            turnId: 'wrong-prefix',
            text: 'hello',
          }),
        ),
      ),
      null,
    );
    assert.equal(
      parseLiveVoiceEvent(
        encoder.encode(
          JSON.stringify({
            schemaVersion: 1,
            type: 'error',
            sessionId: 'voice_session_test',
            message: 'x'.repeat(2_001),
          }),
        ),
      ),
      null,
    );
  });
});
