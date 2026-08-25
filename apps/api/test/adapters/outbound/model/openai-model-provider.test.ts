import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { ModelProviderError } from '../../../../src/ports/model/model-provider.ts';
import { OpenAiModelProvider } from '../../../../src/adapters/outbound/model/openai-model-provider.ts';

const generationInput = {
  purpose: 'orchestration_decision' as const,
  systemPrompt: 'system',
  message: 'hello',
  outputSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    oneOf: [
      {
        type: 'object',
        properties: { kind: { type: 'string', const: 'respond' } },
        required: ['kind'],
        additionalProperties: false,
      },
    ],
  },
};

function providerWith(fetchImplementation: typeof globalThis.fetch) {
  return new OpenAiModelProvider({
    baseUrl: 'https://openai.test/v1',
    apiKey: 'openai-secret',
    model: 'gpt-test',
    timeoutMs: 1_000,
    readinessTimeoutMs: 250,
    maxOutputTokens: 2_048,
    fetch: fetchImplementation,
  });
}

function toRequestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const OpenAiRequestSchema = z.object({
  store: z.boolean(),
  max_output_tokens: z.number(),
  text: z.object({
    format: z.object({
      type: z.literal('json_schema'),
      strict: z.boolean(),
      schema: z.object({
        type: z.literal('object'),
        properties: z.object({
          result: z.looseObject({
            anyOf: z.array(z.unknown()).optional(),
            $schema: z.unknown().optional(),
          }),
        }),
      }),
    }),
  }),
});

void describe('OpenAI model adapter', () => {
  void it('uses Responses structured output and normalizes metadata', async () => {
    let requestedUrl = '';
    let authorization = '';
    let requestBody: unknown;
    const provider = providerWith((input, init) => {
      requestedUrl = toRequestUrl(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      if (typeof init?.body !== 'string') {
        throw new TypeError('Expected a string request body.');
      }
      requestBody = JSON.parse(init.body);
      return Promise.resolve(
        Response.json({
          model: 'gpt-test-2026-01-01',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ result: { kind: 'respond' } }),
                },
              ],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 7 },
        }),
      );
    });

    const generation = await provider.generateStructured(generationInput);
    const parsedRequest = OpenAiRequestSchema.parse(requestBody);

    assert.equal(requestedUrl, 'https://openai.test/v1/responses');
    assert.equal(authorization, 'Bearer openai-secret');
    assert.equal(parsedRequest.store, false);
    assert.equal(parsedRequest.max_output_tokens, 2_048);
    assert.equal(parsedRequest.text.format.type, 'json_schema');
    assert.equal(parsedRequest.text.format.strict, true);
    assert.equal(parsedRequest.text.format.schema.type, 'object');
    assert.ok(parsedRequest.text.format.schema.properties.result.anyOf);
    assert.equal(
      parsedRequest.text.format.schema.properties.result.$schema,
      undefined,
    );
    assert.deepEqual(generation.candidate, { kind: 'respond' });
    assert.equal(generation.provider, 'openai');
    assert.equal(generation.model, 'gpt-test-2026-01-01');
    assert.deepEqual(generation.usage, {
      inputTokens: 12,
      outputTokens: 7,
    });
  });

  void it('checks model access without inference', async () => {
    const provider = providerWith((input, init) => {
      assert.equal(
        toRequestUrl(input),
        'https://openai.test/v1/models/gpt-test',
      );
      assert.equal(init?.method, 'GET');
      return Promise.resolve(Response.json({ id: 'gpt-test' }));
    });

    const readiness = await provider.checkReadiness();
    assert.equal(readiness.provider, 'openai');
    assert.equal(readiness.model, 'gpt-test');
  });

  void it('classifies refusals and never includes upstream bodies in errors', async () => {
    const refusing = providerWith(() =>
      Promise.resolve(
        Response.json({
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'No.' }],
            },
          ],
        }),
      ),
    );
    await assert.rejects(
      refusing.generateStructured(generationInput),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_request_rejected',
    );

    const rejected = providerWith(() =>
      Promise.resolve(
        new Response('openai-secret echoed by upstream', { status: 401 }),
      ),
    );
    await assert.rejects(
      rejected.generateStructured(generationInput),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_request_rejected' &&
        !error.message.includes('openai-secret'),
    );
  });
});
