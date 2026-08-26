import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { OpenAiWebResearchCapability } from '../../../../../src/adapters/outbound/capabilities/web-research/openai-web-research-capability.ts';
import { ModelProviderError } from '../../../../../src/ports/model/model-provider.ts';

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function capabilityWith(fetchImplementation: typeof globalThis.fetch) {
  return new OpenAiWebResearchCapability({
    baseUrl: 'https://openai.test/v1',
    apiKey: 'research-secret',
    model: 'gpt-research-test',
    timeoutMs: 1_000,
    readinessTimeoutMs: 250,
    maxOutputTokens: 2_048,
    maxWebSearchCalls: 4,
    searchContextSize: 'medium',
    fetch: fetchImplementation,
    clock: () => '2026-08-25T12:00:00.000Z',
  });
}

const invocation = {
  schemaVersion: 1 as const,
  invocationId: 'invocation_research_test',
  arguments: { objective: 'Compare two current public approaches.' },
  limits: {
    maxDurationMs: 750,
    maxArtifactBytes: 100_000,
    maxWebSearchCalls: 2,
  },
};

const RequestSchema = z
  .object({
    model: z.literal('gpt-research-test'),
    instructions: z.string().min(1),
    input: z.literal(invocation.arguments.objective),
    tools: z.array(
      z
        .object({
          type: z.literal('web_search'),
          search_context_size: z.literal('medium'),
        })
        .strict(),
    ),
    include: z.tuple([z.literal('web_search_call.action.sources')]),
    max_tool_calls: z.literal(2),
    max_output_tokens: z.literal(2_048),
    store: z.literal(false),
  })
  .strict();

void describe('OpenAI web-research capability', () => {
  void it('uses bounded Responses web search and returns a source-backed report', async () => {
    let body: unknown;
    const capability = capabilityWith((input, init) => {
      assert.equal(requestUrl(input), 'https://openai.test/v1/responses');
      assert.ok(init);
      assert.equal(init.method, 'POST');
      assert.equal(
        new Headers(init.headers).get('authorization'),
        'Bearer research-secret',
      );
      assert.equal(typeof init.body, 'string');
      body = JSON.parse(init.body as string);
      return Promise.resolve(
        Response.json({
          status: 'completed',
          model: 'gpt-research-test-2026-08-01',
          output: [
            {
              type: 'web_search_call',
              action: {
                sources: [
                  { type: 'url', url: 'https://example.test/a' },
                  { type: 'url', url: 'https://source-only.test/c' },
                ],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '## Findings\n\nThe approaches differ.',
                  annotations: [
                    {
                      type: 'url_citation',
                      title: 'Primary source duplicate',
                      url: 'https://example.test/a',
                    },
                    {
                      type: 'url_citation',
                      title: 'Secondary source',
                      url: 'https://example.test/b',
                    },
                  ],
                },
              ],
            },
          ],
          usage: { input_tokens: 21, output_tokens: 13 },
        }),
      );
    });

    const result = await capability.execute(invocation);

    RequestSchema.parse(body);
    assert.deepEqual(result.report, {
      schemaVersion: 1,
      objective: invocation.arguments.objective,
      report: '## Findings\n\nThe approaches differ.',
      sources: [
        { title: 'Primary source duplicate', url: 'https://example.test/a' },
        { title: 'source-only.test', url: 'https://source-only.test/c' },
        { title: 'Secondary source', url: 'https://example.test/b' },
      ],
      searchedAt: '2026-08-25T12:00:00.000Z',
    });
    assert.equal(result.model.provider, 'openai');
    assert.equal(result.model.model, 'gpt-research-test-2026-08-01');
    assert.deepEqual(result.model.usage, {
      inputTokens: 21,
      outputTokens: 13,
    });
  });

  void it('checks exact model access without performing a search', async () => {
    const capability = capabilityWith((input, init) => {
      assert.equal(
        requestUrl(input),
        'https://openai.test/v1/models/gpt-research-test',
      );
      assert.equal(init?.method, 'GET');
      return Promise.resolve(Response.json({ id: 'gpt-research-test' }));
    });

    await capability.checkReadiness();
  });

  void it('fails closed when a response has no verified web search evidence', async () => {
    const capability = capabilityWith(() =>
      Promise.resolve(
        Response.json({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'An unsupported answer.',
                  annotations: [],
                },
              ],
            },
          ],
        }),
      ),
    );

    await assert.rejects(
      capability.execute(invocation),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_response_invalid',
    );
  });

  void it('fails closed when the provider does not complete synchronously', async () => {
    const capability = capabilityWith(() =>
      Promise.resolve(
        Response.json({
          status: 'incomplete',
          output: [],
        }),
      ),
    );

    await assert.rejects(
      capability.execute(invocation),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_response_invalid',
    );
  });

  void it('fails closed when observed search calls exceed approved authority', async () => {
    const capability = capabilityWith(() =>
      Promise.resolve(
        Response.json({
          status: 'completed',
          output: [
            ...Array.from({ length: 3 }, () => ({
              type: 'web_search_call',
              action: {
                sources: [{ type: 'url', url: 'https://example.test/source' }],
              },
            })),
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'A report.',
                  annotations: [],
                },
              ],
            },
          ],
        }),
      ),
    );

    await assert.rejects(
      capability.execute(invocation),
      (error: unknown) =>
        error instanceof ModelProviderError &&
        error.code === 'provider_response_invalid',
    );
  });

  void it('normalizes provider rejection without retaining an upstream body', async () => {
    const capability = capabilityWith(() =>
      Promise.resolve(
        new Response('research-secret and owner request', { status: 403 }),
      ),
    );

    await assert.rejects(capability.execute(invocation), (error: unknown) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, 'provider_request_rejected');
      assert.equal(error.message.includes('research-secret'), false);
      assert.equal(
        error.message.includes(invocation.arguments.objective),
        false,
      );
      return true;
    });
  });
});
