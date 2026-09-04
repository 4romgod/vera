import type {
  PushMessage,
  PushNotificationProvider,
  PushReceiptResult,
  PushSendResult,
} from '../../../ports/notifications/push-notification-provider.ts';

type Fetch = typeof fetch;

export class ExpoPushNotificationProvider implements PushNotificationProvider {
  readonly name = 'expo';
  private readonly fetch: Fetch;
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    accessToken?: string;
    timeoutMs: number;
    fetch?: Fetch;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? fetch;
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    const response = await this.request('/--/api/v2/push/send', {
      to: message.token,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: 'default',
      priority: 'high',
      channelId: 'vera-attention',
    });
    if (response.kind !== 'ok')
      return response.kind === 'retryable'
        ? { status: 'retryable', code: response.code }
        : { status: 'rejected', code: response.code, deviceInvalid: false };
    const root = record(response.value);
    const data = root === undefined ? undefined : root.data;
    const ticket = record(Array.isArray(data) ? data[0] : data);
    if (ticket?.status === 'ok' && typeof ticket.id === 'string')
      return { status: 'accepted', ticketId: ticket.id };
    const details = record(ticket?.details);
    const code = stringCode(details?.error) ?? 'expo_ticket_rejected';
    return {
      status: 'rejected',
      code,
      deviceInvalid: code === 'DeviceNotRegistered',
    };
  }

  async receipt(ticketId: string): Promise<PushReceiptResult> {
    const response = await this.request('/--/api/v2/push/getReceipts', {
      ids: [ticketId],
    });
    if (response.kind !== 'ok')
      return response.kind === 'retryable'
        ? { status: 'retryable', code: response.code }
        : { status: 'rejected', code: response.code, deviceInvalid: false };
    const root = record(response.value);
    const data = record(root?.data);
    const receipt = record(data?.[ticketId]);
    if (receipt === undefined) return { status: 'pending' };
    if (receipt.status === 'ok') return { status: 'delivered' };
    const code =
      stringCode(record(receipt.details)?.error) ?? 'expo_receipt_rejected';
    return {
      status: 'rejected',
      code,
      deviceInvalid: code === 'DeviceNotRegistered',
    };
  }

  checkReadiness(): Promise<void> {
    const url = new URL(this.baseUrl);
    if (url.protocol !== 'https:')
      throw new Error('Expo push delivery must use HTTPS.');
    return Promise.resolve();
  }

  private async request(
    path: string,
    body: unknown,
  ): Promise<
    | { kind: 'ok'; value: unknown }
    | { kind: 'retryable'; code: string }
    | { kind: 'rejected'; code: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.accessToken === undefined
            ? {}
            : { authorization: `Bearer ${this.accessToken}` }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500)
        return {
          kind: 'retryable',
          code: `expo_http_${String(response.status)}`,
        };
      if (!response.ok)
        return {
          kind: 'rejected',
          code: `expo_http_${String(response.status)}`,
        };
      return { kind: 'ok', value: await response.json() };
    } catch (error) {
      return {
        kind: 'retryable',
        code:
          error instanceof Error && error.name === 'AbortError'
            ? 'expo_timeout'
            : 'expo_unavailable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function stringCode(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, 100)
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
