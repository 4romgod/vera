import {
  ModelProviderError,
  type ModelProviderErrorCode,
} from '../../../ports/model/model-provider.ts';

export function classifyProviderStatus(status: number): ModelProviderErrorCode {
  if (status === 404) return 'model_not_found';
  if (status >= 400 && status < 500) return 'provider_request_rejected';
  return 'provider_unavailable';
}

export function isProviderTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export async function requestProvider(options: {
  provider: string;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  fetch: typeof globalThis.fetch;
}): Promise<Response> {
  try {
    return await options.fetch(options.url, {
      ...options.init,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    if (isProviderTimeout(error)) {
      throw new ModelProviderError(
        `${options.provider} did not respond within ${String(options.timeoutMs)}ms`,
        'provider_timeout',
        { cause: error },
      );
    }
    throw new ModelProviderError(
      `${options.provider} could not be reached`,
      'provider_unavailable',
      { cause: error },
    );
  }
}

export function requireProviderSuccess(
  provider: string,
  response: Response,
): void {
  if (response.ok) return;
  // Do not retain the provider body: an upstream error may echo sensitive
  // request material. Status and normalized classification are sufficient.
  throw new ModelProviderError(
    `${provider} returned HTTP ${String(response.status)}`,
    classifyProviderStatus(response.status),
  );
}

export async function readProviderJson(
  provider: string,
  response: Response,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new ModelProviderError(
      `${provider} returned malformed response JSON`,
      'provider_response_invalid',
      { cause: error },
    );
  }
}
