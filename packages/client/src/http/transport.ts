import { VeraApiError } from '../errors.ts';
import {
  createClient as createGeneratedClient,
  type Client as GeneratedClient,
} from '../generated/client/index.ts';

type Fetch = typeof globalThis.fetch;

export async function delay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw (
      signal.reason ??
      new DOMException('The operation was aborted.', 'AbortError')
    );
  }
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted.', 'AbortError'),
      );
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class VeraHttpTransport {
  protected readonly baseUrl: string;
  protected readonly fetch: Fetch;
  protected readonly generatedClient: GeneratedClient;

  public constructor(options?: { baseUrl?: string; fetch?: Fetch }) {
    this.baseUrl = (options?.baseUrl ?? 'http://127.0.0.1:4310').replace(
      /\/$/u,
      '',
    );
    this.fetch =
      options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.generatedClient = createGeneratedClient({
      adapter: 'fetch',
      baseURL: this.baseUrl,
      env: {
        fetch: this.fetch,
        // Axios otherwise wraps calls in a Request object before invoking the
        // injected fetch. Vera's established seam intentionally exposes the
        // portable fetch(url, init) shape to callers and tests.
        Request: null as never,
      },
      throwOnError: false,
    });
    this.generatedClient.instance.interceptors.request.use((request) => {
      // Axios otherwise assigns application/x-www-form-urlencoded to POST,
      // PUT, and PATCH requests without a body. Fastify then attempts to parse
      // content that does not exist and rejects the request before routing it.
      if (request.data === undefined) {
        request.headers.set('Content-Type', null);
      }
      return request;
    });
  }

  protected generatedData<T>(result: GeneratedResult<T>): T {
    if (result.error !== undefined || result.data === undefined) {
      const status = result.response?.status;
      if (status === undefined) {
        if (result instanceof Error) throw result;
        throw new Error('Vera request failed before receiving a response.');
      }
      throw this.errorFromBody(status, result.error);
    }
    return result.data;
  }

  protected async generatedRequest<T>(
    request: PromiseLike<GeneratedResult<T>>,
  ): Promise<T> {
    return this.generatedData(await request);
  }

  protected async apiError(response: Response): Promise<VeraApiError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return this.errorFromBody(response.status, body);
  }

  protected errorFromBody(status: number, body: unknown): VeraApiError {
    const error =
      isRecord(body) && isRecord(body.error) ? body.error : undefined;
    const code =
      error !== undefined && typeof error.code === 'string'
        ? error.code
        : 'request_failed';
    const message =
      error !== undefined && typeof error.message === 'string'
        ? error.message
        : `Vera request failed with HTTP ${String(status)}.`;
    return new VeraApiError(message, status, code, body);
  }
}

type GeneratedResult<T> = {
  data: T | undefined;
  error?: unknown;
  response?: { status: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
