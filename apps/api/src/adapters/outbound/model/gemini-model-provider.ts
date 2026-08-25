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

const GeminiModelSchema = z.looseObject({
  name: z.string().min(1),
  version: z.string().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
});

const GeminiResponseSchema = z.looseObject({
  modelVersion: z.string().optional(),
  candidates: z
    .array(
      z.looseObject({
        finishReason: z.string().optional(),
        content: z
          .looseObject({
            parts: z.array(z.looseObject({ text: z.string().optional() })),
          })
          .optional(),
      }),
    )
    .default([]),
  promptFeedback: z
    .looseObject({ blockReason: z.string().optional() })
    .optional(),
  usageMetadata: z
    .looseObject({
      promptTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type GeminiModelProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  readinessTimeoutMs: number;
  maxOutputTokens: number;
  fetch?: typeof globalThis.fetch;
};

export class GeminiModelProvider implements ModelProvider {
  public readonly name = 'gemini';
  public readonly dataBoundary = 'third_party';
  public readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: GeminiModelProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model.replace(/^models\//u, '');
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
    requireProviderSuccess('Gemini', response);
    const parsed = GeminiModelSchema.safeParse(
      await readProviderJson('Gemini', response),
    );
    if (
      !parsed.success ||
      parsed.data.name !== `models/${this.model}` ||
      (parsed.data.supportedGenerationMethods !== undefined &&
        !parsed.data.supportedGenerationMethods.includes('generateContent'))
    ) {
      throw new ModelProviderError(
        'Gemini model response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }
    return {
      provider: this.name,
      model: this.model,
      durationMs: Math.round(performance.now() - startedAt),
      ...(parsed.data.version === undefined
        ? {}
        : { providerVersion: parsed.data.version }),
    };
  }

  public async generateStructured(
    input: GenerateStructuredInput,
  ): Promise<ModelGeneration> {
    const startedAt = performance.now();
    const response = await this.request(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: input.message }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: this.maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: cloudStructuredOutputSchema(input.outputSchema),
          },
        }),
      },
      this.timeoutMs,
    );
    requireProviderSuccess('Gemini', response);
    const parsed = GeminiResponseSchema.safeParse(
      await readProviderJson('Gemini', response),
    );
    if (!parsed.success) {
      throw new ModelProviderError(
        'Gemini response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }

    const blocked =
      parsed.data.promptFeedback?.blockReason !== undefined ||
      parsed.data.candidates.some((candidate) =>
        ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(
          candidate.finishReason ?? '',
        ),
      );
    if (blocked) {
      throw new ModelProviderError(
        'Gemini blocked the structured generation request',
        'provider_request_rejected',
      );
    }

    const outputText = parsed.data.candidates
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .find((part) => part.text !== undefined)?.text;
    if (outputText === undefined) {
      throw new ModelProviderError(
        'Gemini response contained no structured output text',
        'provider_response_invalid',
      );
    }

    let candidate: unknown;
    try {
      candidate = unwrapCloudStructuredOutput(JSON.parse(outputText));
    } catch (error) {
      throw new ModelProviderError(
        'Gemini returned malformed structured output',
        'provider_response_invalid',
        { cause: error },
      );
    }

    const usage = parsed.data.usageMetadata;
    const normalizedUsage =
      usage?.promptTokenCount === undefined ||
      usage.candidatesTokenCount === undefined
        ? undefined
        : {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
          };
    return {
      candidate,
      provider: this.name,
      model: parsed.data.modelVersion ?? this.model,
      durationMs: Math.round(performance.now() - startedAt),
      ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
    };
  }

  private request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('x-goog-api-key', this.apiKey);
    return requestProvider({
      provider: 'Gemini',
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
