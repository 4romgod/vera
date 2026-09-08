import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRegisteredModuleLoader } from '../src/voice/livekit-client-loader.ts';

void describe('LiveKit client loading', () => {
  void it('registers native globals before evaluating the client module', async () => {
    const calls: string[] = [];
    const load = createRegisteredModuleLoader({
      initialize: () => calls.push('register-globals'),
      load: () => {
        calls.push('load-client');
        return Promise.resolve({ ready: true });
      },
    });

    assert.deepEqual(await load(), { ready: true });
    assert.deepEqual(calls, ['register-globals', 'load-client']);
  });

  void it('shares successful loads and permits a retry after failure', async () => {
    let attempts = 0;
    const load = createRegisteredModuleLoader({
      initialize: () => undefined,
      load: () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('load failed'));
        return Promise.resolve('livekit');
      },
    });

    await assert.rejects(load(), /load failed/u);
    assert.equal(await load(), 'livekit');
    assert.equal(await load(), 'livekit');
    assert.equal(attempts, 2);
  });
});
