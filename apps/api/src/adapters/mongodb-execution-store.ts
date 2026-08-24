import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  TaskAggregateJsonSchema,
  TaskAggregateSchema,
  type TaskAggregate,
} from '../domain/task-aggregate.ts';
import type {
  CreateAggregateResult,
  ExecutionStore,
} from '../ports/execution-store.ts';

const COLLECTION_NAME = 'task_execution_aggregates';

// MongoDB supports a constrained JSON Schema dialect. Keep this translation
// small and regression-tested whenever Zod or TaskAggregateJsonSchema changes.
export function toMongoJsonSchema(value: unknown, topLevel = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toMongoJsonSchema(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !['$schema', 'format', 'propertyNames'].includes(key))
      .filter(
        ([key]) =>
          !['const', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key),
      )
      .map(([key, item]) =>
        key === 'type' && item === 'integer'
          ? ['bsonType', ['int', 'long', 'double', 'decimal']]
          : [key, toMongoJsonSchema(item)],
      ),
  );
  if ('const' in source) {
    result.enum = [source.const];
  }
  if (typeof source.exclusiveMinimum === 'number') {
    result.minimum = source.exclusiveMinimum;
    result.exclusiveMinimum = true;
  }
  if (typeof source.exclusiveMaximum === 'number') {
    result.maximum = source.exclusiveMaximum;
    result.exclusiveMaximum = true;
  }
  if (topLevel) {
    result.properties = {
      _id: { bsonType: 'objectId' },
      ...(result.properties as Record<string, unknown>),
    };
  }
  return result;
}

export const MongoTaskAggregateJsonSchema = toMongoJsonSchema(
  TaskAggregateJsonSchema,
  true,
) as Document;

export type MongoDbExecutionStoreOptions = {
  uri: string;
  database: string;
  timeoutMs: number;
  client?: MongoClient;
};

export class MongoDbExecutionStore implements ExecutionStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly collection: Collection;
  private connection: Promise<void> | undefined;

  public constructor(options: MongoDbExecutionStoreOptions) {
    this.client =
      options.client ??
      new MongoClient(options.uri, {
        connectTimeoutMS: options.timeoutMs,
        serverSelectionTimeoutMS: options.timeoutMs,
      });
    this.database = this.client.db(options.database);
    this.collection = this.database.collection(COLLECTION_NAME);
  }

  public async create(
    aggregate: TaskAggregate,
  ): Promise<CreateAggregateResult> {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      { 'task.requestKey': aggregate.task.requestKey },
      { $setOnInsert: aggregate },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      return { created: true, aggregate };
    }

    const existing = await this.findByRequestKey(aggregate.task.requestKey);
    if (existing === null) {
      throw new Error('MongoDB idempotent create did not return an aggregate.');
    }
    return { created: false, aggregate: existing };
  }

  public async findByRequestKey(
    requestKey: string,
  ): Promise<TaskAggregate | null> {
    return this.findOne({ 'task.requestKey': requestKey });
  }

  public async findByTaskId(taskId: string): Promise<TaskAggregate | null> {
    return this.findOne({ 'task.id': taskId });
  }

  public async findByRunId(runId: string): Promise<TaskAggregate | null> {
    return this.findOne({ 'run.id': runId });
  }

  public async findByApprovalId(
    approvalId: string,
  ): Promise<TaskAggregate | null> {
    return this.findOne({ 'run.approval.id': approvalId });
  }

  public async replace(
    aggregate: TaskAggregate,
    expectedVersion: number,
  ): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.collection.replaceOne(
      { 'task.id': aggregate.task.id, version: expectedVersion },
      aggregate,
    );
    return result.modifiedCount === 1;
  }

  public async findRecoverable(): Promise<TaskAggregate[]> {
    await this.ensureConnected();
    const documents = await this.collection
      .find({
        $or: [
          { 'run.status': 'deciding' },
          { 'run.status': 'executing' },
          { 'run.status': 'awaiting_approval' },
        ],
      })
      .toArray();
    return documents.map((document) => this.parse(document));
  }

  public async checkReadiness(): Promise<void> {
    await this.ensureConnected();
    await this.client.db().command({ ping: 1 });
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private async findOne(filter: Document): Promise<TaskAggregate | null> {
    await this.ensureConnected();
    const document = await this.collection.findOne(filter);
    return document === null ? null : this.parse(document);
  }

  private parse(document: Document): TaskAggregate {
    const { _id: ignored, ...aggregate } = document;
    void ignored;
    return TaskAggregateSchema.parse(aggregate);
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
        validator: { $jsonSchema: MongoTaskAggregateJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await this.database.createCollection(COLLECTION_NAME, {
        validator: { $jsonSchema: MongoTaskAggregateJsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    await Promise.all([
      this.collection.createIndex({ 'task.id': 1 }, { unique: true }),
      this.collection.createIndex({ 'task.requestKey': 1 }, { unique: true }),
      this.collection.createIndex({ 'run.id': 1 }, { unique: true }),
      this.collection.createIndex(
        { 'run.approval.id': 1 },
        {
          unique: true,
          partialFilterExpression: { 'run.approval.id': { $exists: true } },
        },
      ),
      this.collection.createIndex({ 'run.status': 1 }),
    ]);
  }
}
