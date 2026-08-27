import { z } from 'zod';

import {
  ModelProviderError,
  type GenerateStructuredInput,
  type ModelGeneration,
  type ModelProvider,
  type ModelProviderErrorCode,
  type ModelProviderReadiness,
} from '../../../ports/model/model-provider.ts';

const OllamaChatResponseSchema = z.looseObject({
  model: z.string().optional(),
  message: z.looseObject({ content: z.string() }),
  done: z.boolean().optional(),
  done_reason: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/u)
    .optional(),
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
  think: OllamaThink;
  timeoutMs: number;
  readinessTimeoutMs: number;
  maxOutputTokens?: number;
  fetch?: typeof globalThis.fetch;
};

export type OllamaThink = boolean | 'low' | 'medium' | 'high';

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
          !['minLength', 'maxLength', 'maxItems', 'pattern'].includes(key),
      )
      .map(([key, item]) => [
        key === 'oneOf' ? 'anyOf' : key,
        toOllamaGrammarSchema(item),
      ]),
  );
}

async function rejectedGrammar(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    return /grammar|json schema conversion failed/iu.test(
      await response.clone().text(),
    );
  } catch {
    return false;
  }
}

export class OllamaModelProvider implements ModelProvider {
  public readonly name = 'ollama';
  public readonly dataBoundary = 'owner_controlled';
  public readonly model: string;

  private readonly baseUrl: string;
  private readonly think: OllamaThink;
  private readonly timeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly maxOutputTokens: number | undefined;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: OllamaModelProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.think = options.think;
    this.timeoutMs = options.timeoutMs;
    this.readinessTimeoutMs = options.readinessTimeoutMs;
    this.maxOutputTokens = options.maxOutputTokens;
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
    const requestGeneration = (format: unknown) =>
      this.request(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: input.systemPrompt },
              {
                role: 'user',
                content: input.message,
                ...(input.images === undefined || input.images.length === 0
                  ? {}
                  : {
                      images: input.images.map((image) =>
                        Buffer.from(image.bytes).toString('base64'),
                      ),
                    }),
              },
            ],
            format,
            stream: false,
            think: this.think,
            options: {
              temperature: 0,
              ...(this.maxOutputTokens === undefined
                ? {}
                : { num_predict: this.maxOutputTokens }),
            },
          }),
        },
        this.timeoutMs,
      );
    // Ollama grammar implementations reject sufficiently nested schemas
    // containing some array/string bounds and regexes, and do not consistently
    // accept `oneOf`. Preserve compatible structural constraints, including
    // minimum array cardinality, and express exclusive discriminator branches
    // as `anyOf`. If this exact provider still rejects grammar initialization,
    // retry in its JSON mode; the full authoritative Zod schema validates the
    // candidate either way.
    let response = await requestGeneration(
      toOllamaGrammarSchema(input.outputSchema),
    );
    if (await rejectedGrammar(response)) {
      response = await requestGeneration('json');
    }
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
    if (body.message.content.trim().length === 0) {
      if (body.done_reason === 'length') {
        throw new ModelProviderError(
          `Ollama exhausted the configured output-token ceiling before completing structured JSON${body.eval_count === undefined ? '' : ` (output tokens: ${String(body.eval_count)})`}`,
          'provider_response_invalid',
        );
      }
      const completion = [
        body.done_reason === undefined
          ? undefined
          : `done reason: ${body.done_reason}`,
        body.eval_count === undefined
          ? undefined
          : `output tokens: ${String(body.eval_count)}`,
      ]
        .filter((value) => value !== undefined)
        .join(', ');
      throw new ModelProviderError(
        `Ollama returned an empty final response${completion.length === 0 ? '' : ` (${completion})`}`,
        'provider_response_invalid',
      );
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(body.message.content);
    } catch (error) {
      const message =
        body.done_reason === 'length'
          ? 'Ollama exhausted the configured output-token ceiling before completing structured JSON'
          : 'Ollama returned malformed JSON despite structured-output mode';
      throw new ModelProviderError(message, 'provider_response_invalid', {
        cause: error,
      });
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
