import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codexProcessEnvironment } from '../src/capabilities/codex-process-environment.ts';

void describe('Codex subprocess environment', () => {
  void it('keeps runtime discovery values and removes Vera credentials', () => {
    assert.deepEqual(
      codexProcessEnvironment({
        PATH: '/usr/bin',
        HOME: '/owner',
        CODEX_HOME: '/owner/.codex',
        OPENAI_API_KEY: 'must-not-cross',
        GEMINI_API_KEY: 'must-not-cross',
        MONGODB_URI: 'mongodb://user:password@example.test/vera',
        REDIS_URL: 'redis://:password@example.test',
        VERA_PROFILE: 'openai',
      }),
      {
        PATH: '/usr/bin',
        HOME: '/owner',
        CODEX_HOME: '/owner/.codex',
      },
    );
  });
});
