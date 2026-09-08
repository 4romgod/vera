import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  startSingleUseSpeechPlayback,
  type SpeechPlaybackPlayer,
  type SpeechPlaybackStatus,
} from '../src/voice/single-use-speech-playback.ts';

function harness() {
  let listener: ((status: SpeechPlaybackStatus) => void) | undefined;
  const calls: string[] = [];
  const player: SpeechPlaybackPlayer = {
    addStatusListener(nextListener) {
      listener = nextListener;
      calls.push('listen');
      return { remove: () => calls.push('unlisten') };
    },
    pause: () => calls.push('pause'),
    play: () => calls.push('play'),
    release: () => calls.push('release-player'),
    replace: (uri) => calls.push(`replace:${uri}`),
  };
  const playback = startSingleUseSpeechPlayback({
    source: {
      uri: 'file:///speech.wav',
      release: () => calls.push('release-source'),
    },
    createPlayer: () => player,
  });
  const emit = (status: Partial<SpeechPlaybackStatus>) => {
    assert.ok(listener);
    listener({ didJustFinish: false, error: null, isLoaded: false, ...status });
  };
  return { calls, emit, playback };
}

void describe('single-use speech playback', () => {
  void it('owns and releases one player through successful playback', async () => {
    const { calls, emit, playback } = harness();
    assert.deepEqual(calls, ['listen', 'replace:file:///speech.wav']);
    emit({ isLoaded: true });
    emit({ isLoaded: true });
    emit({ didJustFinish: true, isLoaded: true });
    await playback.promise;
    assert.deepEqual(calls, [
      'listen',
      'replace:file:///speech.wav',
      'play',
      'unlisten',
      'release-player',
      'release-source',
    ]);
  });

  void it('interrupts active playback without reusing a released player', async () => {
    const { calls, emit, playback } = harness();
    emit({ isLoaded: true });
    playback.interrupt();
    playback.interrupt();
    await assert.rejects(playback.promise, /interrupted/u);
    assert.deepEqual(calls, [
      'listen',
      'replace:file:///speech.wav',
      'play',
      'pause',
      'unlisten',
      'release-player',
      'release-source',
    ]);
  });

  void it('releases an unloaded player without attempting to pause it', async () => {
    const { calls, playback } = harness();
    playback.interrupt();
    await assert.rejects(playback.promise, /interrupted/u);
    assert.equal(calls.includes('pause'), false);
    assert.equal(calls.filter((call) => call === 'release-player').length, 1);
  });
});
