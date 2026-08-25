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
        socketTimeoutMS: options.timeoutMs,
      });
    this.database = this.client.db(options.database);
    this.collection = this.database.collection(COLLECTION_NAME);
  }

  public async create(
    aggregate: TaskAggregate,
  ): Promise<CreateAggregateResult> {
    await this.ensureConnected();
    const result = await this.collection.updateOne(
      {
        'task.principalId': aggregate.task.principalId,
        'task.requestKey': aggregate.task.requestKey,
      },
      { $setOnInsert: aggregate },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      return { created: true, aggregate };
    }

    const existing = await this.findByRequestKey(
      aggregate.task.principalId,
      aggregate.task.requestKey,
    );
    if (existing === null) {
      throw new Error('MongoDB idempotent create did not return an aggregate.');
    }
    return { created: false, aggregate: existing };
  }

  public async findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<TaskAggregate | null> {
    return this.findOne({
      'task.principalId': principalId,
      'task.requestKey': requestKey,
    });
  }

  public async findByTaskId(
    principalId: string,
    taskId: string,
  ): Promise<TaskAggregate | null> {
    return this.findOne({
      'task.principalId': principalId,
      'task.id': taskId,
    });
  }

  public async findByRunId(
    principalId: string,
    runId: string,
  ): Promise<TaskAggregate | null> {
    return this.findOne({
      'task.principalId': principalId,
      'run.id': runId,
    });
  }

  public async findByApprovalId(
    principalId: string,
    approvalId: string,
  ): Promise<TaskAggregate | null> {
    return this.findOne({
      'task.principalId': principalId,
      'run.approval.id': approvalId,
    });
  }

  public async replace(
    aggregate: TaskAggregate,
    expectedVersion: number,
  ): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.collection.replaceOne(
      {
        'task.principalId': aggregate.task.principalId,
        'task.id': aggregate.task.id,
        version: expectedVersion,
      },
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
          { 'run.status': 'cancellation_requested' },
        ],
      })
      .toArray();
    return documents.map((document) => this.parse(document));
  }

  public async findDispatchable(limit: number): Promise<TaskAggregate[]> {
    await this.ensureConnected();
    const documents = await this.collection
      .find({
        $or: [
          { 'run.status': 'deciding' },
          { 'run.status': 'executing' },
          { 'run.status': 'cancellation_requested' },
          {
            'run.status': 'awaiting_approval',
            'run.approval.status': 'approved',
          },
        ],
      })
      .sort({ 'run.createdAt': 1 })
      .limit(limit)
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
      await this.migrateLegacyApprovalContract();
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
    const indexes = await this.collection.indexes();
    const legacyRequestIndex = indexes.find(
      (index) =>
        index.unique === true &&
        Object.keys(index.key).length === 1 &&
        index.key['task.requestKey'] === 1,
    );
    if (legacyRequestIndex?.name !== undefined) {
      await this.collection.dropIndex(legacyRequestIndex.name);
    }
    await Promise.all([
      this.collection.createIndex({ 'task.id': 1 }, { unique: true }),
      this.collection.createIndex(
        { 'task.principalId': 1, 'task.requestKey': 1 },
        { unique: true },
      ),
      this.collection.createIndex({ 'run.id': 1 }, { unique: true }),
      this.collection.createIndex(
        { 'run.approval.id': 1 },
        {
          unique: true,
          partialFilterExpression: { 'run.approval.id': { $exists: true } },
        },
      ),
      this.collection.createIndex({ 'run.status': 1 }),
      this.collection.createIndex({ 'run.status': 1, 'run.createdAt': 1 }),
    ]);
  }

  private async migrateLegacyApprovalContract(): Promise<void> {
    await this.collection.updateMany(
      { 'run.approval.reason': 'external_capability_invocation' },
      {
        $set: { 'run.approval.reason': 'specialist_capability_invocation' },
        $inc: { version: 1 },
      },
      { bypassDocumentValidation: true },
    );
    await this.collection.updateMany(
      { 'run.approval.destination.kind': 'codex' },
      [
        {
          $set: {
            'run.approval.destination': {
              schemaVersion: 1,
              adapterId: 'codex_cli',
              provider: 'openai',
              transport: 'local_process',
              dataBoundary: 'third_party',
            },
          },
        },
        {
          $unset: [
            'run.approval.destination.kind',
            'run.approval.destination.trust',
          ],
        },
        { $set: { version: { $add: ['$version', 1] } } },
      ],
      { bypassDocumentValidation: true },
    );
    await this.collection.updateMany(
      { 'run.approval.destination.kind': 'model' },
      [
        {
          $set: {
            'run.approval.destination': {
              schemaVersion: 1,
              adapterId: 'structured_model',
              provider: 'legacy_model',
              transport: 'in_process',
              dataBoundary: {
                $cond: [
                  { $eq: ['$run.approval.destination.trust', 'local'] },
                  'owner_controlled',
                  'third_party',
                ],
              },
            },
          },
        },
        {
          $unset: [
            'run.approval.destination.kind',
            'run.approval.destination.trust',
          ],
        },
        { $set: { version: { $add: ['$version', 1] } } },
      ],
      { bypassDocumentValidation: true },
    );
  }
}
