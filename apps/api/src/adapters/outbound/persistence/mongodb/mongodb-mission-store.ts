import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  MissionJsonSchema,
  MissionSchema,
  type Mission,
} from '../../../../domain/missions/mission.ts';
import type { MissionStore } from '../../../../ports/persistence/mission-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION_NAME = 'missions';
export const MongoMissionJsonSchema = mongoDocumentSchema(MissionJsonSchema);

export class MongoDbMissionStore implements MissionStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly collection: Collection;
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
    this.collection = this.database.collection(COLLECTION_NAME);
  }

  public async create(mission: Mission) {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      { principalId: mission.principalId, requestKey: mission.requestKey },
      { $setOnInsert: mission },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, mission };
    const existing = await this.collection.findOne({
      principalId: mission.principalId,
      requestKey: mission.requestKey,
    });
    if (existing === null)
      throw new Error('MongoDB mission create returned no resource.');
    return { created: false, mission: this.parse(existing) };
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({ principalId, requestKey });
    return document === null ? null : this.parse(document);
  }

  public async findById(principalId: string, missionId: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      id: missionId,
    });
    return document === null ? null : this.parse(document);
  }

  public async list(principalId: string, limit: number) {
    await this.ensureConnected();
    const documents = await this.collection
      .find({ principalId })
      .sort({ createdAt: -1, id: -1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => this.parse(document));
  }

  public async replace(mission: Mission, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.collection.replaceOne(
      {
        principalId: mission.principalId,
        id: mission.id,
        version: expectedVersion,
      },
      mission,
    );
    return result.modifiedCount === 1;
  }

  public async findDispatchable(limit: number) {
    await this.ensureConnected();
    const documents = await this.collection
      .find({ status: { $in: ['approved', 'executing'] } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => this.parse(document));
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
    const documents = await this.collection
      .find({
        principalId,
        notification: { $exists: true },
        ...(after === undefined
          ? {}
          : {
              $or: [
                { 'notification.deliveredAt': { $gt: after.deliveredAt } },
                {
                  'notification.deliveredAt': after.deliveredAt,
                  'notification.id': { $gt: after.id },
                },
              ],
            }),
      })
      .sort({ 'notification.deliveredAt': 1, 'notification.id': 1 })
      .limit(options.limit)
      .toArray();
    return documents.flatMap((document) => {
      const notification = this.parse(document).notification;
      return notification === undefined ? [] : [notification];
    });
  }

  public async checkReadiness() {
    await this.ensureConnected();
    await this.database.command({ ping: 1 });
  }

  public async close() {
    await this.client.close();
  }

  private ensureConnected(): Promise<void> {
    return (this.connection ??= this.connect().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    }));
  }

  private async connect() {
    await this.client.connect();
    const exists = await this.database
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .hasNext();
    if (exists) {
      await this.database.command({
        collMod: COLLECTION_NAME,
        validator: { $jsonSchema: MongoMissionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoMissionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    await Promise.all([
      this.collection.createIndex({ id: 1 }, { unique: true }),
      this.collection.createIndex(
        { principalId: 1, requestKey: 1 },
        { unique: true },
      ),
      this.collection.createIndex({ principalId: 1, createdAt: -1, id: -1 }),
      this.collection.createIndex({ status: 1, createdAt: 1 }),
      this.collection.createIndex({
        principalId: 1,
        'notification.deliveredAt': 1,
        'notification.id': 1,
      }),
    ]);
  }

  private parse(document: Document): Mission {
    const { _id: ignored, ...value } = document;
    void ignored;
    return MissionSchema.parse(value);
  }
}
