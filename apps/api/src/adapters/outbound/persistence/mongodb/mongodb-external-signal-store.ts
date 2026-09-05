import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  ExternalSignalJsonSchema,
  ExternalSignalSchema,
  type ExternalSignal,
} from '../../../../domain/external-awareness/external-signal.ts';
import { externalSignalNotification } from '../../../../domain/external-awareness/external-signal-notification.ts';
import type { ExternalSignalStore } from '../../../../ports/persistence/external-signal-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION = 'external_signals';
export const MongoExternalSignalJsonSchema = mongoDocumentSchema(
  ExternalSignalJsonSchema,
);

export class MongoDbExternalSignalStore implements ExternalSignalStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly signals: Collection;
  private connection: Promise<void> | undefined;

  public constructor(options: {
    uri: string;
    database: string;
    timeoutMs: number;
    client?: MongoClient;
  }) {
    this.client =
      options.client ??
      new MongoClient(options.uri, {
        connectTimeoutMS: options.timeoutMs,
        serverSelectionTimeoutMS: options.timeoutMs,
        socketTimeoutMS: options.timeoutMs,
      });
    this.database = this.client.db(options.database);
    this.signals = this.database.collection(COLLECTION);
  }

  public async findById(principalId: string, signalId: string) {
    await this.ensureConnected();
    const document = await this.signals.findOne({ principalId, id: signalId });
    return document === null ? null : this.parse(document);
  }

  public async upsert(signal: ExternalSignal): Promise<{
    created: boolean;
    changed: boolean;
    signal: ExternalSignal;
  }> {
    await this.ensureConnected();
    const currentDocument = await this.signals.findOne({ id: signal.id });
    if (currentDocument === null) {
      try {
        await this.signals.insertOne(signal);
        return { created: true, changed: true, signal };
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        return this.upsert(signal);
      }
    }
    const current = this.parse(currentDocument);
    const changed = fingerprint(current) !== fingerprint(signal);
    if (!changed) return { created: false, changed: false, signal: current };
    const next = ExternalSignalSchema.parse({
      ...signal,
      version: current.version + 1,
    });
    const result = await this.signals.replaceOne(
      { id: current.id, version: current.version },
      next,
    );
    return result.modifiedCount === 1
      ? { created: false, changed: true, signal: next }
      : this.upsert(signal);
  }

  public async resolveMissing(input: {
    principalId: string;
    routineId: string;
    activeIds: string[];
    resolvedAt: string;
  }) {
    await this.ensureConnected();
    const filter: Document = {
      principalId: input.principalId,
      routineId: input.routineId,
      status: 'active',
      ...(input.activeIds.length === 0
        ? {}
        : { id: { $nin: input.activeIds } }),
    };
    const result = await this.signals.updateMany(filter, {
      $set: {
        status: 'resolved',
        resolvedAt: input.resolvedAt,
        lastObservedAt: input.resolvedAt,
      },
      $inc: { version: 1 },
    });
    return result.modifiedCount;
  }

  public async listActive(principalId: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.signals
        .find({ principalId, status: 'active' })
        .sort({ occurredAt: -1, id: -1 })
        .limit(limit)
        .toArray()
    ).map((document) => this.parse(document));
  }

  public async listByRoutine(
    principalId: string,
    routineId: string,
    limit: number,
  ) {
    await this.ensureConnected();
    return (
      await this.signals
        .find({ principalId, routineId })
        .sort({ occurredAt: -1, id: -1 })
        .limit(limit)
        .toArray()
    ).map((document) => this.parse(document));
  }

  public async listNotifications(
    principalId: string,
    options: {
      after?: { deliveredAt: string; id: string };
      limit: number;
    },
  ) {
    await this.ensureConnected();
    const after = options.after;
    const filter: Document =
      after === undefined
        ? { principalId }
        : {
            principalId,
            $or: [
              { firstObservedAt: { $gt: after.deliveredAt } },
              {
                firstObservedAt: after.deliveredAt,
                id: { $gt: notificationToSignalId(after.id) },
              },
            ],
          };
    return (
      await this.signals
        .find(filter)
        .sort({ firstObservedAt: 1, id: 1 })
        .limit(options.limit)
        .toArray()
    ).map((document) => externalSignalNotification(this.parse(document)));
  }

  public async checkReadiness() {
    await this.ensureConnected();
    await this.database.command({ ping: 1 });
  }

  public async close() {
    await this.client.close();
  }

  private ensureConnected() {
    return (this.connection ??= this.connect().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    }));
  }

  private async connect() {
    await this.client.connect();
    const exists = await this.database
      .listCollections({ name: COLLECTION }, { nameOnly: true })
      .hasNext();
    if (exists) {
      await this.database.command({
        collMod: COLLECTION,
        validator: { $jsonSchema: MongoExternalSignalJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION, {
        validator: { $jsonSchema: MongoExternalSignalJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    await Promise.all([
      this.signals.createIndex({ id: 1 }, { unique: true }),
      this.signals.createIndex(
        { principalId: 1, routineId: 1, externalKey: 1 },
        { unique: true },
      ),
      this.signals.createIndex({ principalId: 1, status: 1, occurredAt: -1 }),
      this.signals.createIndex({ principalId: 1, firstObservedAt: 1, id: 1 }),
    ]);
  }

  private parse(document: Document) {
    const { _id: ignored, ...value } = document;
    void ignored;
    return ExternalSignalSchema.parse(value);
  }
}

function fingerprint(signal: ExternalSignal) {
  return JSON.stringify([
    signal.category,
    signal.title,
    signal.summary,
    signal.url,
    signal.occurredAt,
    signal.status,
  ]);
}

function notificationToSignalId(notificationId: string) {
  return notificationId.startsWith('notification_')
    ? `external_signal_${notificationId.slice('notification_'.length)}`
    : notificationId;
}

function isDuplicateKey(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
