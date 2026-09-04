import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  RoutineJsonSchema,
  RoutineRunJsonSchema,
  RoutineRunSchema,
  RoutineSchema,
  type Routine,
  type RoutineRun,
} from '../../../../domain/routines/routine.ts';
import type { RoutineStore } from '../../../../ports/persistence/routine-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const ROUTINES = 'routines';
const RUNS = 'routine_runs';
export const MongoRoutineJsonSchema = mongoDocumentSchema(RoutineJsonSchema);
export const MongoRoutineRunJsonSchema =
  mongoDocumentSchema(RoutineRunJsonSchema);

export class MongoDbRoutineStore implements RoutineStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly routines: Collection;
  private readonly runs: Collection;
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
    this.routines = this.database.collection(ROUTINES);
    this.runs = this.database.collection(RUNS);
  }

  public async create(routine: Routine) {
    await this.ensureConnected();
    const result = await this.routines.updateOne(
      { principalId: routine.principalId, requestKey: routine.requestKey },
      { $setOnInsert: routine },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, routine };
    const existing = await this.routines.findOne({
      principalId: routine.principalId,
      requestKey: routine.requestKey,
    });
    if (existing === null)
      throw new Error('MongoDB routine create returned no resource.');
    return { created: false, routine: this.parseRoutine(existing) };
  }

  public async findByRequestKey(principalId: string, requestKey: string) {
    await this.ensureConnected();
    const value = await this.routines.findOne({ principalId, requestKey });
    return value === null ? null : this.parseRoutine(value);
  }

  public async findById(principalId: string, routineId: string) {
    await this.ensureConnected();
    const value = await this.routines.findOne({ principalId, id: routineId });
    return value === null ? null : this.parseRoutine(value);
  }

  public async list(principalId: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.routines
        .find({ principalId })
        .sort({ createdAt: -1, id: -1 })
        .limit(limit)
        .toArray()
    ).map((value) => this.parseRoutine(value));
  }

  public async replace(routine: Routine, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.routines.replaceOne(
      {
        principalId: routine.principalId,
        id: routine.id,
        version: expectedVersion,
      },
      routine,
    );
    return result.modifiedCount === 1;
  }

  public async findDue(now: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.routines
        .find({ status: 'active', nextRunAt: { $lte: now } })
        .sort({ nextRunAt: 1 })
        .limit(limit)
        .toArray()
    ).map((value) => this.parseRoutine(value));
  }

  public async createRun(run: RoutineRun) {
    await this.ensureConnected();
    const result = await this.runs.updateOne(
      { routineId: run.routineId, occurrenceKey: run.occurrenceKey },
      { $setOnInsert: run },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, run };
    const existing = await this.runs.findOne({
      routineId: run.routineId,
      occurrenceKey: run.occurrenceKey,
    });
    if (existing === null)
      throw new Error('MongoDB routine-run create returned no resource.');
    return { created: false, run: this.parseRun(existing) };
  }

  public async findRunById(principalId: string, runId: string) {
    await this.ensureConnected();
    const value = await this.runs.findOne({ principalId, id: runId });
    return value === null ? null : this.parseRun(value);
  }

  public async listRuns(principalId: string, routineId: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.runs
        .find({ principalId, routineId })
        .sort({ createdAt: -1, id: -1 })
        .limit(limit)
        .toArray()
    ).map((value) => this.parseRun(value));
  }

  public async replaceRun(run: RoutineRun, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.runs.replaceOne(
      { principalId: run.principalId, id: run.id, version: expectedVersion },
      run,
    );
    return result.modifiedCount === 1;
  }

  public async findRunnable(limit: number) {
    await this.ensureConnected();
    return (
      await this.runs
        .find({ status: { $in: ['queued', 'executing'] } })
        .sort({ createdAt: 1 })
        .limit(limit)
        .toArray()
    ).map((value) => this.parseRun(value));
  }

  public async listAttentionRuns(principalId: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.runs
        .find({
          principalId,
          $or: [
            { status: 'failed' },
            { status: 'succeeded', 'result.outcome': 'attention_required' },
          ],
        })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray()
    ).map((value) => this.parseRun(value));
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
    await this.ensureCollection(ROUTINES, MongoRoutineJsonSchema);
    await this.ensureCollection(RUNS, MongoRoutineRunJsonSchema);
    await Promise.all([
      this.routines.createIndex({ id: 1 }, { unique: true }),
      this.routines.createIndex(
        { principalId: 1, requestKey: 1 },
        { unique: true },
      ),
      this.routines.createIndex({ principalId: 1, createdAt: -1 }),
      this.routines.createIndex({ status: 1, nextRunAt: 1 }),
      this.runs.createIndex({ id: 1 }, { unique: true }),
      this.runs.createIndex(
        { routineId: 1, occurrenceKey: 1 },
        { unique: true },
      ),
      this.runs.createIndex({ principalId: 1, routineId: 1, createdAt: -1 }),
      this.runs.createIndex({ status: 1, createdAt: 1 }),
      this.runs.createIndex({ principalId: 1, status: 1, updatedAt: -1 }),
    ]);
  }

  private async ensureCollection(
    name: string,
    schema: Record<string, unknown>,
  ) {
    const exists = await this.database
      .listCollections({ name }, { nameOnly: true })
      .hasNext();
    if (exists) {
      await this.database.command({
        collMod: name,
        validator: { $jsonSchema: schema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(name, {
        validator: { $jsonSchema: schema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
  }

  private parseRoutine(document: Document): Routine {
    const { _id: ignored, ...value } = document;
    void ignored;
    return RoutineSchema.parse(value);
  }
  private parseRun(document: Document): RoutineRun {
    const { _id: ignored, ...value } = document;
    void ignored;
    return RoutineRunSchema.parse(value);
  }
}
