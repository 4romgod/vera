import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { z } from 'zod';

import {
  KnowledgeSourceSchema,
  type KnowledgeSource,
} from '../../../../domain/knowledge/knowledge.ts';
import type {
  KnowledgeSourceId,
  KnowledgeStore,
} from '../../../../ports/persistence/knowledge-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION_NAME = 'knowledge_sources';
export const MongoKnowledgeSourceJsonSchema = mongoDocumentSchema(
  z.toJSONSchema(KnowledgeSourceSchema, { target: 'draft-7' }),
);

export class MongoDbKnowledgeStore implements KnowledgeStore {
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

  public async create(source: KnowledgeSource) {
    await this.ensureConnected();
    const validated = KnowledgeSourceSchema.parse(source);
    const result = await this.collection.updateOne(
      { principalId: validated.principalId, requestKey: validated.requestKey },
      { $setOnInsert: validated },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, source: validated };
    const existing = await this.findByRequestKey(
      validated.principalId,
      validated.requestKey,
    );
    if (existing === null) {
      throw new Error('MongoDB knowledge create returned no resource.');
    }
    return { created: false, source: existing };
  }

  public async findById(principalId: string, sourceId: KnowledgeSourceId) {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      id: sourceId,
    });
    return document === null ? null : this.parse(document);
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({ principalId, requestKey });
    return document === null ? null : this.parse(document);
  }

  public async list(
    principalId: string,
    options: {
      status: 'active' | 'all';
      scope?: KnowledgeSource['scope'];
      limit: number;
    },
  ) {
    await this.ensureConnected();
    const documents = await this.collection
      .find({
        principalId,
        ...(options.status === 'all' ? {} : { status: 'active' }),
        ...(options.scope === undefined ? {} : { scope: options.scope }),
      })
      .sort({ updatedAt: -1, id: -1 })
      .limit(options.limit)
      .toArray();
    return documents.map((document) => this.parse(document));
  }

  public async remove(input: {
    principalId: string;
    sourceId: KnowledgeSourceId;
    removedAt: string;
    expectedRevision: number;
  }) {
    await this.ensureConnected();
    const result = await this.collection.findOneAndUpdate(
      {
        principalId: input.principalId,
        id: input.sourceId,
        revision: input.expectedRevision,
      },
      {
        $set: {
          status: 'removed',
          chunks: [],
          updatedAt: input.removedAt,
          removedAt: input.removedAt,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    );
    return result === null ? null : this.parse(result);
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
        validator: { $jsonSchema: MongoKnowledgeSourceJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoKnowledgeSourceJsonSchema },
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
      this.collection.createIndex({ principalId: 1, status: 1, updatedAt: -1 }),
    ]);
  }

  private parse(document: Document): KnowledgeSource {
    const { _id: ignored, ...value } = document;
    void ignored;
    return KnowledgeSourceSchema.parse(value);
  }
}
