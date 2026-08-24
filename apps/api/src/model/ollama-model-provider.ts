import { z } from 'zod';

import { ModelProposalJsonSchema } from '../domain/model-proposal.ts';
import { buildModelSystemPrompt } from './model-system-prompt.ts';
import {
  ModelProviderError,
  type GenerateStructuredInput,
  type ModelGeneration,
  type ModelProvider,
  type ModelProviderErrorCode,
  type ModelProviderReadiness,
} from './model-provider.ts';

const OllamaChatResponseSchema = z.looseObject({
  model: z.string().optional(),
  message: z.looseObject({ content: z.string() }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

const OllamaVersionResponseSchema = z.looseObject({
  version: z.string().min(1),
});

const OllamaTagsResponseSchema = z.looseObject({
  models: z.array(
    z.looseObject({
      name: z.string().optional(),
      model: z.string().optional(),
    }),
  ),
});

export type OllamaModelProviderOptions = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  readinessTimeoutMs: number;
  fetch?: typeof globalThis.fetch;
};

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function classifyUnsuccessfulResponse(
  status: number,
  detail: string,
): ModelProviderErrorCode {
  if (status === 404 && /model.+not found/iu.test(detail)) {
    return 'model_not_found';
  }
  if (status >= 400 && status < 500) {
    return 'provider_request_rejected';
  }
  return 'provider_unavailable';
}

function matchesModelReference(configured: string, available: string): boolean {
  return (
    available === configured ||
    (!configured.includes(':') && available === `${configured}:latest`)
  );
}

function toOllamaGrammarSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toOllamaGrammarSchema(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !['minLength', 'maxLength', 'minItems', 'maxItems'].includes(key),
      )
      .map(([key, item]) => [key, toOllamaGrammarSchema(item)]),
  );
}

export class OllamaModelProvider implements ModelProvider {
  public readonly name = 'ollama';
  public readonly model: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: OllamaModelProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.readinessTimeoutMs = options.readinessTimeoutMs;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async checkReadiness(): Promise<ModelProviderReadiness> {
    const startedAt = performance.now();
    const versionResponse = await this.request(
      '/api/version',
      { method: 'GET' },
      this.readinessTimeoutMs,
    );
    await this.requireSuccess(versionResponse);
    const versionBody = await this.readJson(versionResponse);
    const parsedVersion = OllamaVersionResponseSchema.safeParse(versionBody);
    if (!parsedVersion.success) {
      throw new ModelProviderError(
        'Ollama version response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }

    const tagsResponse = await this.request(
      '/api/tags',
      { method: 'GET' },
      this.readinessTimeoutMs,
    );
    await this.requireSuccess(tagsResponse);
    const tagsBody = await this.readJson(tagsResponse);
    const parsedTags = OllamaTagsResponseSchema.safeParse(tagsBody);
    if (!parsedTags.success) {
      throw new ModelProviderError(
        'Ollama tags response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }

    const modelAvailable = parsedTags.data.models.some((candidate) =>
      [candidate.name, candidate.model].some(
        (reference) =>
          reference !== undefined &&
          matchesModelReference(this.model, reference),
      ),
    );
    if (!modelAvailable) {
      throw new ModelProviderError(
        `Configured Ollama model ${this.model} is not installed`,
        'model_not_found',
      );
    }

    return {
      provider: this.name,
      model: this.model,
      durationMs: Math.round(performance.now() - startedAt),
      providerVersion: parsedVersion.data.version,
    };
  }

  public async generateStructured(
    input: GenerateStructuredInput,
  ): Promise<ModelGeneration> {
    const startedAt = performance.now();
    const response = await this.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.message },
          ],
          // Ollama's grammar compiler rejects sufficiently nested schemas
          // containing array/string bounds. Preserve the structural schema for
          // generation and enforce every bound with the authoritative Zod
          // parser after generation.
          format: toOllamaGrammarSchema(input.outputSchema),
          stream: false,
          think: false,
          options: { temperature: 0 },
        }),
      },
      this.timeoutMs,
    );
    await this.requireSuccess(response);

    const untrustedBody = await this.readJson(response);
    const parsedBody = OllamaChatResponseSchema.safeParse(untrustedBody);
    if (!parsedBody.success) {
      throw new ModelProviderError(
        'Ollama response did not satisfy the adapter contract',
        'provider_response_invalid',
      );
    }

    const body = parsedBody.data;
    let candidate: unknown;
    try {
      candidate = JSON.parse(body.message.content);
    } catch (error) {
      throw new ModelProviderError(
        'Ollama returned malformed JSON despite structured-output mode',
        'provider_response_invalid',
        { cause: error },
      );
    }

    return {
      candidate,
      provider: this.name,
      model: body.model ?? this.model,
      durationMs: Math.round(performance.now() - startedAt),
      usage: {
        inputTokens: body.prompt_eval_count ?? 0,
        outputTokens: body.eval_count ?? 0,
      },
    };
  }

  public generateProposal(input: {
    message: string;
  }): Promise<ModelGeneration> {
    return this.generateStructured({
      purpose: 'orchestration_decision',
      systemPrompt: buildModelSystemPrompt(),
      message: input.message,
      outputSchema: ModelProposalJsonSchema,
    });
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new ModelProviderError(
          `Ollama did not respond within ${String(timeoutMs)}ms`,
          'provider_timeout',
          { cause: error },
        );
      }

      throw new ModelProviderError(
        'Ollama could not be reached',
        'provider_unavailable',
        { cause: error },
      );
    }
  }

  private async requireSuccess(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }

    let detail: string;
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      detail = 'response body unavailable';
    }

    throw new ModelProviderError(
      `Ollama returned HTTP ${String(response.status)}: ${detail}`,
      classifyUnsuccessfulResponse(response.status, detail),
    );
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new ModelProviderError(
        'Ollama returned malformed response JSON',
        'provider_response_invalid',
        { cause: error },
      );
    }
  }
}
