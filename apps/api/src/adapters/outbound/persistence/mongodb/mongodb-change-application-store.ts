import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  SoftwareChangeApplicationJsonSchema,
  SoftwareChangeApplicationSchema,
  type SoftwareChangeApplication,
} from '../../../../domain/changes/software-change-application.ts';
import type { ChangeApplicationStore } from '../../../../ports/persistence/change-application-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION_NAME = 'change_applications';
export const MongoSoftwareChangeApplicationJsonSchema = mongoDocumentSchema(
  SoftwareChangeApplicationJsonSchema,
);

export type MongoDbChangeApplicationStoreOptions = {
  uri: string;
  database: string;
  timeoutMs: number;
  client?: MongoClient;
};

export class MongoDbChangeApplicationStore implements ChangeApplicationStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly collection: Collection;
  private connection: Promise<void> | undefined;

  public constructor(options: MongoDbChangeApplicationStoreOptions) {
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

  public async create(application: SoftwareChangeApplication): Promise<{
    created: boolean;
    application: SoftwareChangeApplication;
  }> {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      {
        principalId: application.principalId,
        requestKey: application.requestKey,
      },
      { $setOnInsert: application },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, application };
    const existing = await this.collection.findOne({
      principalId: application.principalId,
      requestKey: application.requestKey,
    });
    if (existing === null) {
      throw new Error(
        'MongoDB idempotent change-application create returned no resource.',
      );
    }
    return { created: false, application: this.parse(existing) };
  }

  public async findById(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangeApplication | null> {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      id: applicationId,
    });
    return document === null ? null : this.parse(document);
  }

  public async findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<SoftwareChangeApplication | null> {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      requestKey,
    });
    return document === null ? null : this.parse(document);
  }

  public async findByApprovalId(
    principalId: string,
    approvalId: string,
  ): Promise<SoftwareChangeApplication | null> {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      'approval.id': approvalId,
    });
    return document === null ? null : this.parse(document);
  }

  public async listBySourceArtifact(
    principalId: string,
    artifactId: string,
    limit: number,
  ): Promise<SoftwareChangeApplication[]> {
    await this.ensureConnected();
    const documents = await this.collection
      .find({ principalId, 'sourceArtifact.id': artifactId })
      .sort({ createdAt: -1, id: -1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => this.parse(document));
  }

  public async replace(
    application: SoftwareChangeApplication,
    expectedVersion: number,
  ): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.collection.replaceOne(
      {
        principalId: application.principalId,
        id: application.id,
        version: expectedVersion,
      },
      application,
    );
    return result.modifiedCount === 1;
  }

  public async findDispatchable(
    limit: number,
  ): Promise<SoftwareChangeApplication[]> {
    await this.ensureConnected();
    const documents = await this.collection
      .find({
        status: {
          $in: ['approved', 'applying', 'cancellation_requested'],
        },
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => this.parse(document));
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
    const collectionExists = await this.database
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .hasNext();
    if (collectionExists) {
      await this.database.command({
        collMod: COLLECTION_NAME,
        validator: { $jsonSchema: MongoSoftwareChangeApplicationJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoSoftwareChangeApplicationJsonSchema },
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
      this.collection.createIndex(
        { principalId: 1, 'approval.id': 1 },
        { unique: true },
      ),
      this.collection.createIndex({
        principalId: 1,
        'sourceArtifact.id': 1,
        createdAt: -1,
        id: -1,
      }),
      this.collection.createIndex({ status: 1, createdAt: 1 }),
    ]);
  }

  private parse(document: Document): SoftwareChangeApplication {
    const { _id: ignored, ...value } = document;
    void ignored;
    return SoftwareChangeApplicationSchema.parse(value);
  }
}
