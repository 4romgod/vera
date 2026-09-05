import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioFrame } from '@livekit/rtc-node';

import { encodeWave } from '../../../../src/adapters/outbound/voice/pcm-wave.ts';

void describe('PCM WAV encoding', () => {
  void it('writes a little-endian WAV header and copies every frame in order', () => {
    const wave = encodeWave([
      new AudioFrame(new Int16Array([1, -2]), 16_000, 1, 2),
      new AudioFrame(new Int16Array([32_767, -32_768]), 16_000, 1, 2),
    ]);
    const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength);

    assert.equal(new TextDecoder().decode(wave.subarray(0, 4)), 'RIFF');
    assert.equal(new TextDecoder().decode(wave.subarray(8, 12)), 'WAVE');
    assert.equal(view.getUint32(24, true), 16_000);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(40, true), 8);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, index) =>
        view.getInt16(44 + index * 2, true),
      ),
      [1, -2, 32_767, -32_768],
    );
  });
});
