import type { AudioFrame } from '@livekit/rtc-node';

const NativeLittleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

export function encodeWave(frames: AudioFrame[]): Uint8Array {
  const first = frames[0];
  if (first === undefined)
    throw new Error('Cannot encode an empty audio turn.');
  const { sampleRate, channels } = first;
  const sampleCount = frames.reduce((total, frame) => {
    if (frame.sampleRate !== sampleRate || frame.channels !== channels) {
      throw new Error('A voice turn contained incompatible audio frames.');
    }
    return total + frame.data.length;
  }, 0);
  const byteLength = sampleCount * Int16Array.BYTES_PER_ELEMENT;
  const wave = new Uint8Array(44 + byteLength);
  const view = new DataView(wave.buffer);
  writeAscii(wave, 0, 'RIFF');
  view.setUint32(4, 36 + byteLength, true);
  writeAscii(wave, 8, 'WAVE');
  writeAscii(wave, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(wave, 36, 'data');
  view.setUint32(40, byteLength, true);
  if (NativeLittleEndian) {
    const samples = new Int16Array(wave.buffer, 44, sampleCount);
    let offset = 0;
    for (const frame of frames) {
      samples.set(frame.data, offset);
      offset += frame.data.length;
    }
  } else {
    let offset = 44;
    for (const frame of frames) {
      for (const sample of frame.data) {
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }
  }
  return wave;
}

function writeAscii(target: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}
