import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatVoiceDuration,
  MAX_VOICE_RECORDING_BYTES,
  mergeVoiceTranscript,
  VOICE_RECORDING_BIT_RATE,
  VOICE_RECORDING_CHANNELS,
  VOICE_RECORDING_SAMPLE_RATE,
  voiceRecordingContentType,
} from '../src/voice/voice-recording';

void describe('voice recording', () => {
  void it('appends one final transcription to an existing reviewed draft', () => {
    assert.equal(
      mergeVoiceTranscript('  Existing thought.  ', '  New words.  '),
      'Existing thought. New words.',
    );
    assert.equal(mergeVoiceTranscript('', 'Hello Vera.'), 'Hello Vera.');
  });

  void it('records efficient mono speech without an automatic duration', () => {
    assert.equal(VOICE_RECORDING_SAMPLE_RATE, 16_000);
    assert.equal(VOICE_RECORDING_CHANNELS, 1);
    assert.equal(VOICE_RECORDING_BIT_RATE, 64_000);
    assert.equal(MAX_VOICE_RECORDING_BYTES, 25_000_000);
  });

  void it('selects provider-supported MIME types for native and web recordings', () => {
    assert.equal(voiceRecordingContentType('file:///voice.m4a'), 'audio/mp4');
    assert.equal(voiceRecordingContentType('file:///voice.wav'), 'audio/wav');
    assert.equal(voiceRecordingContentType('file:///voice.mp3'), 'audio/mpeg');
  });

  void it('formats an elapsed recording duration', () => {
    assert.equal(formatVoiceDuration(0), '00:00');
    assert.equal(formatVoiceDuration(65_900), '01:05');
  });
});
