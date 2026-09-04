import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  AttentionDecisionJsonSchema,
  AttentionDecisionSchema,
  type AttentionDecision,
} from '../../../../domain/attention/attention.ts';
import type { AttentionDecisionStore } from '../../../../ports/persistence/attention-decision-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION_NAME = 'attention_decisions';
export const MongoAttentionDecisionJsonSchema = mongoDocumentSchema(
  AttentionDecisionJsonSchema,
);

export class MongoDbAttentionDecisionStore implements AttentionDecisionStore {
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

  public async create(decision: AttentionDecision) {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      { principalId: decision.principalId, requestKey: decision.requestKey },
      { $setOnInsert: decision },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, decision };
    const existing = await this.findByRequestKey(
      decision.principalId,
      decision.requestKey,
    );
    if (existing === null)
      throw new Error('Attention decision create returned no resource.');
    return { created: false, decision: existing };
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({ principalId, requestKey });
    return document === null ? null : this.parse(document);
  }

  public async listLatestByItem(
    principalId: string,
    attentionItemIds: string[],
  ) {
    await this.ensureConnected();
    if (attentionItemIds.length === 0)
      return new Map<string, AttentionDecision>();
    const documents = await this.collection
      .find({ principalId, attentionItemId: { $in: attentionItemIds } })
      .sort({ $natural: -1 })
      .toArray();
    const result = new Map<string, AttentionDecision>();
    for (const document of documents) {
      const decision = this.parse(document);
      if (!result.has(decision.attentionItemId)) {
        result.set(decision.attentionItemId, decision);
      }
    }
    return result;
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
        validator: { $jsonSchema: MongoAttentionDecisionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoAttentionDecisionJsonSchema },
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
      this.collection.createIndex({
        principalId: 1,
        attentionItemId: 1,
        decidedAt: -1,
      }),
    ]);
  }

  private parse(document: Document): AttentionDecision {
    const { _id: ignored, ...value } = document;
    void ignored;
    return AttentionDecisionSchema.parse(value);
  }
}
