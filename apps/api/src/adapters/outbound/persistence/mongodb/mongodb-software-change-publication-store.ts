import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  SoftwareChangePublicationJsonSchema,
  SoftwareChangePublicationSchema,
  type SoftwareChangePublication,
} from '../../../../domain/changes/software-change-publication.ts';
import type { SoftwareChangePublicationStore } from '../../../../ports/persistence/software-change-publication-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION_NAME = 'software_change_publications';
export const MongoSoftwareChangePublicationJsonSchema = mongoDocumentSchema(
  SoftwareChangePublicationJsonSchema,
);

export class MongoDbSoftwareChangePublicationStore
  implements SoftwareChangePublicationStore
{
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

  public async create(publication: SoftwareChangePublication) {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      {
        principalId: publication.principalId,
        requestKey: publication.requestKey,
      },
      { $setOnInsert: publication },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, publication };
    const existing = await this.collection.findOne({
      principalId: publication.principalId,
      requestKey: publication.requestKey,
    });
    if (existing === null)
      throw new Error('MongoDB publication create returned no resource.');
    return { created: false, publication: this.parse(existing) };
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({ principalId, requestKey });
    return document === null ? null : this.parse(document);
  }

  public async findById(principalId: string, publicationId: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      id: publicationId,
    });
    return document === null ? null : this.parse(document);
  }

  public async replace(
    publication: SoftwareChangePublication,
    expectedVersion: number,
  ) {
    await this.ensureConnected();
    const result = await this.collection.replaceOne(
      {
        principalId: publication.principalId,
        id: publication.id,
        version: expectedVersion,
      },
      publication,
    );
    return result.modifiedCount === 1;
  }

  public async findDispatchable(limit: number) {
    await this.ensureConnected();
    const documents = await this.collection
      .find({ status: { $in: ['approved', 'publishing'] } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => this.parse(document));
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
        validator: { $jsonSchema: MongoSoftwareChangePublicationJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoSoftwareChangePublicationJsonSchema },
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
      this.collection.createIndex({ status: 1, createdAt: 1 }),
    ]);
  }

  private parse(document: Document): SoftwareChangePublication {
    const { _id: ignored, ...value } = document;
    void ignored;
    return SoftwareChangePublicationSchema.parse(value);
  }
}
