import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  DevelopmentCampaignJsonSchema,
  DevelopmentCampaignSchema,
  type DevelopmentCampaign,
} from '../../../../domain/development-campaigns/development-campaign.ts';
import type { DevelopmentCampaignStore } from '../../../../ports/persistence/development-campaign-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION_NAME = 'development_campaigns';
export const MongoDevelopmentCampaignJsonSchema = mongoDocumentSchema(
  DevelopmentCampaignJsonSchema,
);

export class MongoDbDevelopmentCampaignStore
  implements DevelopmentCampaignStore
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

  public async create(campaign: DevelopmentCampaign) {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      { principalId: campaign.principalId, requestKey: campaign.requestKey },
      { $setOnInsert: campaign },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, campaign };
    const existing = await this.collection.findOne({
      principalId: campaign.principalId,
      requestKey: campaign.requestKey,
    });
    if (existing === null)
      throw new Error('MongoDB campaign create returned no resource.');
    return { created: false, campaign: this.parse(existing) };
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({ principalId, requestKey });
    return document === null ? null : this.parse(document);
  }

  public async findById(principalId: string, campaignId: string) {
    await this.ensureConnected();
    const document = await this.collection.findOne({
      principalId,
      id: campaignId,
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

  public async replace(campaign: DevelopmentCampaign, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.collection.replaceOne(
      {
        principalId: campaign.principalId,
        id: campaign.id,
        version: expectedVersion,
      },
      campaign,
    );
    return result.modifiedCount === 1;
  }

  public async findDispatchable(limit: number) {
    await this.ensureConnected();
    const documents = await this.collection
      .find({
        status: {
          $in: [
            'approved',
            'implementing',
            'applying',
            'verifying',
            'publishing',
            'observing',
            'merging',
            'synchronizing',
          ],
        },
      })
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
        validator: { $jsonSchema: MongoDevelopmentCampaignJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoDevelopmentCampaignJsonSchema },
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
    ]);
  }

  private parse(document: Document): DevelopmentCampaign {
    const { _id: ignored, ...value } = document;
    void ignored;
    return DevelopmentCampaignSchema.parse(value);
  }
}
