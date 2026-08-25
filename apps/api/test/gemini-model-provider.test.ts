import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { GeminiModelProvider } from '../src/model/gemini-model-provider.ts';
import { ModelProviderError } from '../src/model/model-provider.ts';

const generationInput = {
  purpose: 'development_plan' as const,
  systemPrompt: 'system',
  message: 'plan this',
  outputSchema: {
    type: 'object',
    properties: { title: { type: 'string', minLength: 1 } },
    required: ['title'],
    additionalProperties: false,
  },
};

function providerWith(fetchImplementation: typeof globalThis.fetch) {
  return new GeminiModelProvider({
    baseUrl: 'https://gemini.test/v1beta',
    apiKey: 'gemini-secret',
    model: 'models/gemini-test',
    timeoutMs: 1_000,
    readinessTimeoutMs: 250,
    maxOutputTokens: 4_096,
    fetch: fetchImplementation,
  });
}

function toRequestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const GeminiRequestSchema = z.object({
  generationConfig: z.object({
    temperature: z.number(),
    maxOutputTokens: z.number(),
    responseMimeType: z.string(),
    responseJsonSchema: z.object({
      properties: z.object({
        result: z.object({
          properties: z.object({
            title: z.looseObject({ minLength: z.unknown().optional() }),
          }),
        }),
      }),
    }),
  }),
});

void describe('Gemini model adapter', () => {
  void it('uses generateContent structured output and normalizes metadata', async () => {
    let requestedUrl = '';
    let apiKey = '';
    let requestBody: unknown;
    const provider = providerWith((input, init) => {
      requestedUrl = toRequestUrl(input);
      apiKey = new Headers(init?.headers).get('x-goog-api-key') ?? '';
      if (typeof init?.body !== 'string') {
        throw new TypeError('Expected a string request body.');
      }
      requestBody = JSON.parse(init.body);
      return Promise.resolve(
        Response.json({
          modelVersion: 'gemini-test-001',
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({ result: { title: 'Plan' } }),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 21,
            candidatesTokenCount: 9,
          },
        }),
      );
    });

    const generation = await provider.generateStructured(generationInput);
    const parsedRequest = GeminiRequestSchema.parse(requestBody);

    assert.equal(
      requestedUrl,
      'https://gemini.test/v1beta/models/gemini-test:generateContent',
    );
    assert.equal(apiKey, 'gemini-secret');
    assert.equal(parsedRequest.generationConfig.temperature, 0);
    assert.equal(parsedRequest.generationConfig.maxOutputTokens, 4_096);
    assert.equal(
      parsedRequest.generationConfig.responseMimeType,
      'application/json',
    );
    assert.equal(
      parsedRequest.generationConfig.responseJsonSchema.properties.result
        .properties.title.minLength,
      undefined,
    );
    assert.deepEqual(generation.candidate, { title: 'Plan' });
    assert.equal(generation.provider, 'gemini');
    assert.equal(generation.model, 'gemini-test-001');
    assert.deepEqual(generation.usage, {
      inputTokens: 21,
      outputTokens: 9,
    });
  });

  void it('checks model access and generateContent support without inference', async () => {
    const provider = providerWith((input, init) => {
      assert.equal(
        toRequestUrl(input),
        'https://gemini.test/v1beta/models/gemini-test',
      );
      assert.equal(init?.method, 'GET');
      return Promise.resolve(
        Response.json({
          name: 'models/gemini-test',
          version: '001',
          supportedGenerationMethods: ['generateContent'],
        }),
      );
    });

    const readiness = await provider.checkReadiness();
    assert.equal(readiness.provider, 'gemini');
    assert.equal(readiness.model, 'gemini-test');
    assert.equal(readiness.providerVersion, '001');
  });

  void it('normalizes provider timeouts', async () => {
    const provider = providerWith(() =>
      Promise.reject(new DOMException('Timed out', 'TimeoutError')),
    );
    await assert.rejects(
      provider.generateStructured(generationInput),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_timeout',
    );
  });

  void it('does not invent token counts when Gemini omits usage fields', async () => {
    const provider = providerWith(() =>
      Promise.resolve(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: JSON.stringify({ result: { title: 'Plan' } }) },
                ],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 30 },
        }),
      ),
    );

    const generation = await provider.generateStructured(generationInput);
    assert.equal(generation.usage, undefined);
  });

  void it('classifies provider safety blocks as rejected requests', async () => {
    const provider = providerWith(() =>
      Promise.resolve(
        Response.json({
          promptFeedback: { blockReason: 'SAFETY' },
        }),
      ),
    );
    await assert.rejects(
      provider.generateStructured(generationInput),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_request_rejected',
    );
  });
});
