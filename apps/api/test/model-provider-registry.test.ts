import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createModelProvider,
  registeredModelProviders,
} from '../src/model/model-provider-registry.ts';

void describe('model provider registry', () => {
  void it('registers every supported provider explicitly', () => {
    assert.deepEqual(registeredModelProviders(), [
      'deterministic',
      'ollama',
      'openai',
      'gemini',
    ]);
  });

  void it('creates providers without exposing configuration to the domain', () => {
    const openai = createModelProvider({
      provider: 'openai',
      baseUrl: 'https://openai.test/v1',
      apiKey: 'secret',
      model: 'gpt-test',
      timeoutMs: 1_000,
      readinessTimeoutMs: 250,
      maxOutputTokens: 1_024,
    });
    const gemini = createModelProvider({
      provider: 'gemini',
      baseUrl: 'https://gemini.test/v1beta',
      apiKey: 'secret',
      model: 'gemini-test',
      timeoutMs: 1_000,
      readinessTimeoutMs: 250,
      maxOutputTokens: 1_024,
    });

    assert.deepEqual(
      [openai.name, openai.model, openai.dataBoundary],
      ['openai', 'gpt-test', 'third_party'],
    );
    assert.deepEqual(
      [gemini.name, gemini.model, gemini.dataBoundary],
      ['gemini', 'gemini-test', 'third_party'],
    );
  });
});
