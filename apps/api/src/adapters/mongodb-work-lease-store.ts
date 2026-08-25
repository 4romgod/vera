import {
  MongoClient,
  MongoServerError,
  type Collection,
  type Db,
} from 'mongodb';

import type { WorkLease, WorkLeaseStore } from '../ports/work-lease-store.ts';

const COLLECTION_NAME = 'run_work_leases';

type WorkLeaseDocument = Omit<WorkLease, 'acquiredAt' | 'expiresAt'> & {
  _id: string;
  acquiredAt: Date;
  expiresAt: Date;
};

export type MongoDbWorkLeaseStoreOptions = {
  uri: string;
  database: string;
  timeoutMs: number;
  client?: MongoClient;
};

export class MongoDbWorkLeaseStore implements WorkLeaseStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly collection: Collection<WorkLeaseDocument>;
  private connection: Promise<void> | undefined;

  public constructor(options: MongoDbWorkLeaseStoreOptions) {
    this.client =
      options.client ??
      new MongoClient(options.uri, {
        connectTimeoutMS: options.timeoutMs,
        serverSelectionTimeoutMS: options.timeoutMs,
        socketTimeoutMS: options.timeoutMs,
      });
    this.database = this.client.db(options.database);
    this.collection = this.database.collection(COLLECTION_NAME);
  }

  public async claim(lease: WorkLease, now: string): Promise<boolean> {
    await this.ensureConnected();
    try {
      const result = await this.collection.updateOne(
        {
          _id: lease.runId,
          $or: [{ expiresAt: { $lte: new Date(now) } }, { token: lease.token }],
        },
        {
          $set: {
            schemaVersion: lease.schemaVersion,
            runId: lease.runId,
            workerId: lease.workerId,
            token: lease.token,
            acquiredAt: new Date(lease.acquiredAt),
            expiresAt: new Date(lease.expiresAt),
          },
        },
        { upsert: true },
      );
      return result.matchedCount === 1 || result.upsertedCount === 1;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11_000) {
        return false;
      }
      throw error;
    }
  }

  public async release(runId: string, token: string): Promise<void> {
    await this.ensureConnected();
    await this.collection.deleteOne({ _id: runId, token });
  }

  public async checkReadiness(): Promise<void> {
    await this.ensureConnected();
    await this.database.command({ ping: 1 });
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private ensureConnected(): Promise<void> {
    const connection = (this.connection ??= this.connect().catch(
      (error: unknown) => {
        this.connection = undefined;
        throw error;
      },
    ));
    return connection;
  }

  private async connect(): Promise<void> {
    await this.client.connect();
    await Promise.all([
      this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.collection.createIndex({ workerId: 1, expiresAt: 1 }),
    ]);
  }
}
