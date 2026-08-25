import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { ModelProviderError } from '../../../../src/ports/model/model-provider.ts';
import { OllamaModelProvider } from '../../../../src/adapters/outbound/model/ollama-model-provider.ts';

function providerWith(fetchImplementation: typeof globalThis.fetch) {
  return new OllamaModelProvider({
    baseUrl: 'http://ollama.test',
    model: 'test-model',
    timeoutMs: 1_000,
    readinessTimeoutMs: 250,
    maxOutputTokens: 2_048,
    fetch: fetchImplementation,
  });
}

function generate(provider: OllamaModelProvider) {
  return provider.generateStructured({
    purpose: 'orchestration_decision',
    systemPrompt: 'Return the requested structured test value.',
    message: 'hello',
    outputSchema: {
      type: 'object',
      properties: { schemaVersion: { type: 'integer' } },
      required: ['schemaVersion'],
      additionalProperties: true,
    },
  });
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function containsGrammarBound(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsGrammarBound(item));
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.entries(value).some(
    ([key, item]) =>
      ['minLength', 'maxLength', 'minItems', 'maxItems'].includes(key) ||
      containsGrammarBound(item),
  );
}

void describe('Ollama model adapter', () => {
  void it('requests structured output and normalizes provider metadata', async () => {
    let requestBody: unknown;
    const provider = providerWith((_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new TypeError('Expected a string request body');
      }
      requestBody = JSON.parse(init.body);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'test-model',
            message: {
              content: JSON.stringify({
                schemaVersion: 1,
                kind: 'respond',
                decisionSummary: 'A direct response is sufficient.',
                message: 'Hello.',
              }),
            },
            prompt_eval_count: 12,
            eval_count: 7,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    const generation = await generate(provider);

    assert.equal(generation.provider, 'ollama');
    assert.deepEqual(generation.usage, { inputTokens: 12, outputTokens: 7 });
    const parsedRequest = z
      .object({
        model: z.string(),
        stream: z.boolean(),
        think: z.boolean(),
        format: z.looseObject({}),
        options: z.object({
          temperature: z.number(),
          num_predict: z.number(),
        }),
      })
      .parse(requestBody);
    assert.equal(parsedRequest.model, 'test-model');
    assert.equal(parsedRequest.stream, false);
    assert.equal(parsedRequest.think, false);
    assert.equal(parsedRequest.options.temperature, 0);
    assert.equal(parsedRequest.options.num_predict, 2_048);
    assert.ok(Object.keys(parsedRequest.format).length > 0);
    assert.equal(containsGrammarBound(parsedRequest.format), false);
  });

  void it('classifies malformed provider JSON', async () => {
    const provider = providerWith(() =>
      Promise.resolve(
        new Response('{not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await assert.rejects(
      generate(provider),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_response_invalid',
    );
  });

  void it('classifies non-success provider responses', async () => {
    const provider = providerWith(() =>
      Promise.resolve(new Response('overloaded', { status: 503 })),
    );

    await assert.rejects(
      generate(provider),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_unavailable',
    );
  });

  void it('classifies a missing configured model separately', async () => {
    const provider = providerWith(() =>
      Promise.resolve(
        new Response('{"error":"model \'test-model\' not found"}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await assert.rejects(
      generate(provider),
      (error: unknown) =>
        error instanceof ModelProviderError && error.code === 'model_not_found',
    );
  });

  void it('classifies other rejected provider requests separately', async () => {
    const provider = providerWith(() =>
      Promise.resolve(
        new Response('{"error":"invalid request"}', { status: 400 }),
      ),
    );

    await assert.rejects(
      generate(provider),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_request_rejected',
    );
  });

  void it('classifies provider timeouts separately', async () => {
    const provider = providerWith(() =>
      Promise.reject(new DOMException('Timed out', 'TimeoutError')),
    );

    await assert.rejects(
      generate(provider),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_timeout',
    );
  });

  void it('checks provider version and configured model readiness', async () => {
    const provider = providerWith((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/version')) {
        return Promise.resolve(
          Response.json({ version: '0.32.9' }, { status: 200 }),
        );
      }
      if (url.endsWith('/api/tags')) {
        return Promise.resolve(
          Response.json(
            { models: [{ name: 'test-model:latest' }] },
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });

    const readiness = await provider.checkReadiness();

    assert.equal(readiness.provider, 'ollama');
    assert.equal(readiness.model, 'test-model');
    assert.equal(readiness.providerVersion, '0.32.9');
    assert.ok(readiness.durationMs >= 0);
  });

  void it('fails readiness when the configured model is absent', async () => {
    const provider = providerWith((input) => {
      const url = requestUrl(input);
      return Promise.resolve(
        url.endsWith('/api/version')
          ? Response.json({ version: '0.32.9' }, { status: 200 })
          : Response.json(
              { models: [{ name: 'different-model:latest' }] },
              { status: 200 },
            ),
      );
    });

    await assert.rejects(
      provider.checkReadiness(),
      (error: unknown) =>
        error instanceof ModelProviderError && error.code === 'model_not_found',
    );
  });
});
