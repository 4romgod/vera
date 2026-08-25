import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadConfig } from '../src/config.ts';

void describe('application configuration', () => {
  void it('defaults to the owner-controlled Ollama provider', () => {
    const config = loadConfig({});
    assert.deepEqual(config.model, {
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'gemma4-12b-64k:latest',
      timeoutMs: 120_000,
      readinessTimeoutMs: 3_000,
      maxOutputTokens: 8_192,
    });
    assert.deepEqual(config.conversationContext, {
      maxMessages: 20,
      maxCharacters: 40_000,
    });
  });

  void it('rejects a non-loopback listener while application authentication is absent', () => {
    assert.throws(() => loadConfig({ HOST: '0.0.0.0' }), /HOST/u);
  });

  void it('requires conversation history limits to preserve whole turns', () => {
    assert.throws(
      () => loadConfig({ CONVERSATION_CONTEXT_MAX_MESSAGES: '3' }),
      /CONVERSATION_CONTEXT_MAX_MESSAGES/u,
    );
  });

  void it('creates an OpenAI provider configuration only with a key', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'openai',
        OPENAI_API_KEY: 'openai-test-key',
        OPENAI_MODEL: 'gpt-test',
      }).model,
      {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'openai-test-key',
        model: 'gpt-test',
        timeoutMs: 120_000,
        readinessTimeoutMs: 3_000,
        maxOutputTokens: 8_192,
      },
    );
    assert.throws(
      () => loadConfig({ VERA_MODEL_PROVIDER: 'openai' }),
      /OPENAI_API_KEY is required/u,
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_MODEL_PROVIDER: 'openai',
          OPENAI_API_KEY: 'openai-test-key',
          OPENAI_BASE_URL: 'http://openai.test/v1',
        }),
      /OPENAI_BASE_URL must use HTTPS/u,
    );
  });

  void it('normalizes a Gemini model reference and requires its key', () => {
    assert.deepEqual(
      loadConfig({
        VERA_MODEL_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-test-key',
        GEMINI_MODEL: 'models/gemini-test',
      }).model,
      {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-test-key',
        model: 'gemini-test',
        timeoutMs: 120_000,
        readinessTimeoutMs: 3_000,
        maxOutputTokens: 8_192,
      },
    );
    assert.throws(
      () => loadConfig({ VERA_MODEL_PROVIDER: 'gemini' }),
      /GEMINI_API_KEY is required/u,
    );
    assert.throws(
      () =>
        loadConfig({
          VERA_MODEL_PROVIDER: 'gemini',
          GEMINI_API_KEY: 'gemini-test-key',
          GEMINI_BASE_URL: 'https://user:password@gemini.test/v1beta',
        }),
      /must not contain embedded credentials/u,
    );
  });
});
