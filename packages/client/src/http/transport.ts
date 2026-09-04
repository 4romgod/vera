import { VeraApiError } from '../contracts/index.ts';
import type {
  TaskResource,
  ChangeApplicationResource,
  SoftwareChangePublicationResource,
  DevelopmentCampaignResource,
  MissionResource,
  RoutineResource,
} from '../contracts/index.ts';
import {
  isRecord,
  assertTaskResource,
  assertChangeApplicationResource,
  assertSoftwareChangePublicationResource,
  assertDevelopmentCampaignResource,
  assertMissionResource,
  assertRoutineResource,
} from '../validation/index.ts';

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

  public constructor(options?: { baseUrl?: string; fetch?: Fetch }) {
    this.baseUrl = (options?.baseUrl ?? 'http://127.0.0.1:4310').replace(
      /\/$/u,
      '',
    );
    this.fetch =
      options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  protected async taskRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<TaskResource> {
    const value: unknown = await this.request(path, options);
    assertTaskResource(value);
    return value;
  }

  protected async changeApplicationRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<ChangeApplicationResource> {
    const value: unknown = await this.request(path, options);
    assertChangeApplicationResource(value);
    return value;
  }

  protected async softwareChangePublicationRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<SoftwareChangePublicationResource> {
    const value: unknown = await this.request(path, options);
    assertSoftwareChangePublicationResource(value);
    return value;
  }

  protected async developmentCampaignRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<DevelopmentCampaignResource> {
    const value: unknown = await this.request(path, options);
    assertDevelopmentCampaignResource(value);
    return value;
  }

  protected async missionRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<MissionResource> {
    const value: unknown = await this.request(path, options);
    assertMissionResource(value);
    return value;
  }

  protected async routineRequest(
    path: string,
    options?: RequestOptions,
  ): Promise<RoutineResource> {
    const value: unknown = await this.request(path, options);
    assertRoutineResource(value);
    return value;
  }

  protected async request<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        ...(options?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options?.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options?.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw this.errorFromBody(response.status, body);
    }
    return body as T;
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

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  idempotencyKey?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};
