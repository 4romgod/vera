import { z } from 'zod';

import {
  readProviderJson,
  requestProvider,
  requireProviderSuccess,
} from './http-provider-support.ts';
import {
  ModelProviderError,
  type GenerateStructuredInput,
  type ModelGeneration,
  type ModelProvider,
  type ModelProviderReadiness,
} from '../../../ports/model/model-provider.ts';
import {
  cloudStructuredOutputSchema,
  unwrapCloudStructuredOutput,
} from './structured-output-schema.ts';

const OpenAiModelSchema = z.looseObject({ id: z.string().min(1) });

const OpenAiResponseSchema = z.looseObject({
  model: z.string().optional(),
  output: z.array(
    z.looseObject({
      type: z.string(),
      content: z
        .array(
          z.looseObject({
            type: z.string(),
            text: z.string().optional(),
            refusal: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  usage: z
    .looseObject({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export type OpenAiModelProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  readinessTimeoutMs: number;
  maxOutputTokens: number;
  fetch?: typeof globalThis.fetch;
};

export class OpenAiModelProvider implements ModelProvider {
  public readonly name = 'openai';
  public readonly dataBoundary = 'third_party';
  public readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: OpenAiModelProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.readinessTimeoutMs = options.readinessTimeoutMs;
    this.maxOutputTokens = options.maxOutputTokens;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async checkReadiness(): Promise<ModelProviderReadiness> {
    const startedAt = performance.now();
    const response = await this.request(
      `/models/${encodeURIComponent(this.model)}`,
      { method: 'GET' },
      this.readinessTimeoutMs,
    );
    requireProviderSuccess('OpenAI', response);
    const parsed = OpenAiModelSchema.safeParse(
      await readProviderJson('OpenAI', response),
    );
    if (!parsed.success || parsed.data.id !== this.model) {
      throw new ModelProviderError(
        'OpenAI model response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }
    return {
      provider: this.name,
      model: parsed.data.id,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  public async generateStructured(
    input: GenerateStructuredInput,
  ): Promise<ModelGeneration> {
    const startedAt = performance.now();
    const response = await this.request(
      '/responses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          instructions: input.systemPrompt,
          input: input.message,
          max_output_tokens: this.maxOutputTokens,
          store: false,
          text: {
            format: {
              type: 'json_schema',
              name: `vera_${input.purpose}`,
              strict: true,
              schema: cloudStructuredOutputSchema(input.outputSchema),
            },
          },
        }),
      },
      this.timeoutMs,
    );
    requireProviderSuccess('OpenAI', response);
    const parsed = OpenAiResponseSchema.safeParse(
      await readProviderJson('OpenAI', response),
    );
    if (!parsed.success) {
      throw new ModelProviderError(
        'OpenAI response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }

    const refusal = parsed.data.output
      .flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'refusal');
    if (refusal !== undefined) {
      throw new ModelProviderError(
        'OpenAI refused the structured generation request',
        'provider_request_rejected',
      );
    }
    const outputText = parsed.data.output
      .flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'output_text')?.text;
    if (outputText === undefined) {
      throw new ModelProviderError(
        'OpenAI response contained no structured output text',
        'provider_response_invalid',
      );
    }

    let candidate: unknown;
    try {
      candidate = unwrapCloudStructuredOutput(JSON.parse(outputText));
    } catch (error) {
      throw new ModelProviderError(
        'OpenAI returned malformed structured output',
        'provider_response_invalid',
        { cause: error },
      );
    }

    return {
      candidate,
      provider: this.name,
      model: parsed.data.model ?? this.model,
      durationMs: Math.round(performance.now() - startedAt),
      ...(parsed.data.usage === undefined
        ? {}
        : {
            usage: {
              inputTokens: parsed.data.usage.input_tokens,
              outputTokens: parsed.data.usage.output_tokens,
            },
          }),
    };
  }

  private request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.apiKey}`);
    return requestProvider({
      provider: 'OpenAI',
      url: `${this.baseUrl}${path}`,
      init: {
        ...init,
        headers,
      },
      timeoutMs,
      fetch: this.fetchImplementation,
    });
  }
}
