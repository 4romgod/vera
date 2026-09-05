import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  IntegrationConnectionJsonSchema,
  IntegrationConnectionSchema,
  type IntegrationConnection,
} from '../../../../domain/integrations/integration-connection.ts';
import type { IntegrationConnectionStore } from '../../../../ports/persistence/integration-connection-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION = 'integration_connections';
export const MongoIntegrationConnectionJsonSchema = mongoDocumentSchema(
  IntegrationConnectionJsonSchema,
);

export class MongoDbIntegrationConnectionStore
  implements IntegrationConnectionStore
{
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly connections: Collection;
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
    this.connections = this.database.collection(COLLECTION);
  }

  public async create(connection: IntegrationConnection) {
    await this.ensureConnected();
    const result = await this.connections.updateOne(
      {
        principalId: connection.principalId,
        integrationId: connection.integrationId,
      },
      { $setOnInsert: connection },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, connection };
    const existing = await this.connections.findOne({
      principalId: connection.principalId,
      integrationId: connection.integrationId,
    });
    if (existing === null)
      throw new Error('MongoDB connection create returned no resource.');
    return { created: false, connection: this.parse(existing) };
  }

  public async findById(principalId: string, connectionId: string) {
    await this.ensureConnected();
    const value = await this.connections.findOne({
      principalId,
      id: connectionId,
    });
    return value === null ? null : this.parse(value);
  }

  public async findByIntegrationId(principalId: string, integrationId: string) {
    await this.ensureConnected();
    const value = await this.connections.findOne({
      principalId,
      integrationId,
    });
    return value === null ? null : this.parse(value);
  }

  public async list(principalId: string) {
    await this.ensureConnected();
    return (
      await this.connections
        .find({ principalId })
        .sort({ integrationId: 1 })
        .toArray()
    ).map((value) => this.parse(value));
  }

  public async replace(
    connection: IntegrationConnection,
    expectedVersion: number,
  ) {
    await this.ensureConnected();
    const result = await this.connections.replaceOne(
      {
        principalId: connection.principalId,
        id: connection.id,
        version: expectedVersion,
      },
      connection,
    );
    return result.modifiedCount === 1;
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
      .listCollections({ name: COLLECTION }, { nameOnly: true })
      .hasNext();
    if (exists) {
      await this.database.command({
        collMod: COLLECTION,
        validator: { $jsonSchema: MongoIntegrationConnectionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION, {
        validator: { $jsonSchema: MongoIntegrationConnectionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    await Promise.all([
      this.connections.createIndex({ id: 1 }, { unique: true }),
      this.connections.createIndex(
        { principalId: 1, integrationId: 1 },
        { unique: true },
      ),
    ]);
  }

  private parse(document: Document): IntegrationConnection {
    const { _id: ignored, ...value } = document;
    void ignored;
    return IntegrationConnectionSchema.parse(value);
  }
}
