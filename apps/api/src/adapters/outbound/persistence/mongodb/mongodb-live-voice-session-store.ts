import {
  MongoClient,
  MongoServerError,
  type Collection,
  type Db,
  type Document,
} from 'mongodb';

import {
  LiveVoiceSessionJsonSchema,
  LiveVoiceSessionSchema,
  type LiveVoiceSession,
} from '../../../../domain/voice/live-voice-session.ts';
import type { LiveVoiceSessionStore } from '../../../../ports/persistence/live-voice-session-store.ts';
import { LiveVoiceSessionConflictError } from '../../../../ports/persistence/live-voice-session-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const COLLECTION = 'live_voice_sessions';
export const MongoLiveVoiceSessionJsonSchema = mongoDocumentSchema(
  LiveVoiceSessionJsonSchema,
);

export class MongoDbLiveVoiceSessionStore implements LiveVoiceSessionStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly sessions: Collection;
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
    this.sessions = this.database.collection(COLLECTION);
  }

  public async create(session: LiveVoiceSession) {
    await this.ensureConnected();
    let result;
    try {
      result = await this.sessions.updateOne(
        { principalId: session.principalId, requestKey: session.requestKey },
        { $setOnInsert: session },
        { upsert: true },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11_000) {
        const existing = await this.sessions.findOne({
          principalId: session.principalId,
          requestKey: session.requestKey,
        });
        if (existing !== null)
          return { created: false, session: this.parse(existing) };
        throw new LiveVoiceSessionConflictError();
      }
      throw error;
    }
    if (result.upsertedCount === 1) return { created: true, session };
    const existing = await this.sessions.findOne({
      principalId: session.principalId,
      requestKey: session.requestKey,
    });
    if (existing === null)
      throw new Error('MongoDB voice-session create returned no resource.');
    return { created: false, session: this.parse(existing) };
  }

  public async findById(principalId: string, sessionId: string) {
    await this.ensureConnected();
    const value = await this.sessions.findOne({ principalId, id: sessionId });
    return value === null ? null : this.parse(value);
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const value = await this.sessions.findOne({ principalId, requestKey });
    return value === null ? null : this.parse(value);
  }

  public async findActive(principalId: string) {
    await this.ensureConnected();
    const value = await this.sessions.findOne(
      {
        principalId,
        status: { $in: ['starting', 'active', 'reconnecting'] },
      },
      { sort: { startedAt: -1 } },
    );
    return value === null ? null : this.parse(value);
  }

  public async replace(session: LiveVoiceSession, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.sessions.replaceOne(
      {
        principalId: session.principalId,
        id: session.id,
        version: expectedVersion,
      },
      session,
    );
    return result.modifiedCount === 1;
  }

  public async findRecoverable() {
    await this.ensureConnected();
    return (
      await this.sessions
        .find({
          status: { $in: ['starting', 'active', 'reconnecting'] },
        })
        .sort({ startedAt: 1 })
        .toArray()
    ).map((value) => this.parse(value));
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
        validator: { $jsonSchema: MongoLiveVoiceSessionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION, {
        validator: { $jsonSchema: MongoLiveVoiceSessionJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    await Promise.all([
      this.sessions.createIndex({ id: 1 }, { unique: true }),
      this.sessions.createIndex(
        { principalId: 1, requestKey: 1 },
        { unique: true },
      ),
      this.sessions.createIndex({ principalId: 1, status: 1, startedAt: -1 }),
      this.sessions.createIndex(
        { principalId: 1, activeSlot: 1 },
        {
          unique: true,
          partialFilterExpression: { activeSlot: 1 },
        },
      ),
    ]);
  }

  private parse(value: Document): LiveVoiceSession {
    const { _id: ignoredId, ...resource } = value;
    void ignoredId;
    return LiveVoiceSessionSchema.parse(resource);
  }
}
