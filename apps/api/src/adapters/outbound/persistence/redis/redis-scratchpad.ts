import { createClient } from 'redis';

import {
  ScratchpadProjectionSchema,
  type Scratchpad,
  type ScratchpadProjection,
} from '../../../../ports/persistence/scratchpad.ts';

const PUT_IF_NEWER_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'version')
if current and tonumber(current) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('HSET', KEYS[1], 'version', ARGV[1], 'payload', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

export type RedisScratchpadOptions = {
  url: string;
  ttlSeconds: number;
  timeoutMs: number;
};

export class RedisScratchpad implements Scratchpad {
  private readonly client;
  private readonly ttlSeconds: number;
  private readonly timeoutMs: number;
  private connection: Promise<void> | undefined;

  public constructor(options: RedisScratchpadOptions) {
    this.client = createClient({
      url: options.url,
      socket: {
        connectTimeout: options.timeoutMs,
        reconnectStrategy: false,
      },
    });
    this.client.on('error', () => {
      // Command failures are surfaced to callers. The listener prevents the
      // Redis client EventEmitter from treating connection errors as fatal.
    });
    this.ttlSeconds = options.ttlSeconds;
    this.timeoutMs = options.timeoutMs;
  }

  public async put(projection: ScratchpadProjection): Promise<void> {
    await this.ensureConnected();
    await this.withTimeout(
      this.client.eval(PUT_IF_NEWER_SCRIPT, {
        keys: [this.key(projection.runId)],
        arguments: [
          String(projection.aggregateVersion),
          JSON.stringify(projection),
          String(this.ttlSeconds),
        ],
      }),
    );
  }

  public async get(runId: string): Promise<ScratchpadProjection | null> {
    await this.ensureConnected();
    const payload = await this.withTimeout(
      this.client.hGet(this.key(runId), 'payload'),
    );
    return payload === null
      ? null
      : ScratchpadProjectionSchema.parse(JSON.parse(payload));
  }

  public async delete(runId: string): Promise<void> {
    await this.ensureConnected();
    await this.withTimeout(this.client.del(this.key(runId)));
  }

  public async checkReadiness(): Promise<void> {
    await this.ensureConnected();
    await this.withTimeout(this.client.ping());
  }

  public async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private key(runId: string): string {
    return `vera:v1:run:${runId}:scratchpad`;
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Redis command timed out.')),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private ensureConnected(): Promise<void> {
    const connection = (this.connection ??= this.client
      .connect()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.connection = undefined;
        throw error;
      }));
    return connection;
  }
}
