import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import {
  NotificationDeviceJsonSchema,
  NotificationDeviceSchema,
  PushDeliveryJsonSchema,
  PushDeliverySchema,
  type NotificationDevice,
  type PushDelivery,
} from '../../../../domain/notifications/push-notification.ts';
import type { PushNotificationStore } from '../../../../ports/persistence/push-notification-store.ts';
import { mongoDocumentSchema } from './mongo-json-schema.ts';

const DEVICES = 'notification_devices';
const DELIVERIES = 'push_deliveries';

export class MongoDbPushNotificationStore implements PushNotificationStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly devices: Collection;
  private readonly deliveries: Collection;
  private connection: Promise<void> | undefined;

  constructor(options: {
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
    this.devices = this.database.collection(DEVICES);
    this.deliveries = this.database.collection(DELIVERIES);
  }

  async upsertDevice(device: NotificationDevice) {
    await this.ensureConnected();
    await this.devices.replaceOne(
      {
        principalId: device.principalId,
        installationId: device.installationId,
      },
      device,
      { upsert: true },
    );
    return device;
  }
  async findDeviceByInstallation(principalId: string, installationId: string) {
    await this.ensureConnected();
    const value = await this.devices.findOne({ principalId, installationId });
    return value === null ? null : this.parseDevice(value);
  }
  async findDeviceById(principalId: string, deviceId: string) {
    await this.ensureConnected();
    const value = await this.devices.findOne({ principalId, id: deviceId });
    return value === null ? null : this.parseDevice(value);
  }
  async listDevices(principalId: string) {
    await this.ensureConnected();
    return (
      await this.devices.find({ principalId }).sort({ updatedAt: -1 }).toArray()
    ).map((item) => this.parseDevice(item));
  }
  async listActiveDevices() {
    await this.ensureConnected();
    return (await this.devices.find({ status: 'active' }).toArray()).map(
      (item) => this.parseDevice(item),
    );
  }
  async replaceDevice(device: NotificationDevice, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.devices.replaceOne(
      { id: device.id, version: expectedVersion },
      device,
    );
    return result.modifiedCount === 1;
  }
  async createDelivery(delivery: PushDelivery) {
    await this.ensureConnected();
    const result = await this.deliveries.updateOne(
      { deviceId: delivery.deviceId, sourceId: delivery.sourceId },
      { $setOnInsert: delivery },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return { created: true, delivery };
    const existing = await this.deliveries.findOne({
      deviceId: delivery.deviceId,
      sourceId: delivery.sourceId,
    });
    if (existing === null)
      throw new Error('MongoDB push delivery create returned no resource.');
    return { created: false, delivery: this.parseDelivery(existing) };
  }
  async findDeliveryById(principalId: string, deliveryId: string) {
    await this.ensureConnected();
    const value = await this.deliveries.findOne({
      principalId,
      id: deliveryId,
    });
    return value === null ? null : this.parseDelivery(value);
  }
  async listDeliveries(principalId: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.deliveries
        .find({ principalId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
    ).map((item) => this.parseDelivery(item));
  }
  async findDueDeliveries(now: string, limit: number) {
    await this.ensureConnected();
    return (
      await this.deliveries
        .find({
          status: { $in: ['queued', 'accepted'] },
          nextAttemptAt: { $lte: now },
        })
        .sort({ nextAttemptAt: 1 })
        .limit(limit)
        .toArray()
    ).map((item) => this.parseDelivery(item));
  }
  async replaceDelivery(delivery: PushDelivery, expectedVersion: number) {
    await this.ensureConnected();
    const result = await this.deliveries.replaceOne(
      { id: delivery.id, version: expectedVersion },
      delivery,
    );
    return result.modifiedCount === 1;
  }
  async checkReadiness() {
    await this.ensureConnected();
    await this.database.command({ ping: 1 });
  }
  async close() {
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
    await this.ensureCollection(
      DEVICES,
      mongoDocumentSchema(NotificationDeviceJsonSchema),
    );
    await this.ensureCollection(
      DELIVERIES,
      mongoDocumentSchema(PushDeliveryJsonSchema),
    );
    await Promise.all([
      this.devices.createIndex({ id: 1 }, { unique: true }),
      this.devices.createIndex(
        { principalId: 1, installationId: 1 },
        { unique: true },
      ),
      this.devices.createIndex({ status: 1 }),
      this.deliveries.createIndex({ id: 1 }, { unique: true }),
      this.deliveries.createIndex(
        { deviceId: 1, sourceId: 1 },
        { unique: true },
      ),
      this.deliveries.createIndex({ status: 1, nextAttemptAt: 1 }),
      this.deliveries.createIndex({ principalId: 1, createdAt: -1 }),
    ]);
  }
  private async ensureCollection(
    name: string,
    schema: Record<string, unknown>,
  ) {
    const exists = await this.database
      .listCollections({ name }, { nameOnly: true })
      .hasNext();
    if (exists)
      await this.database.command({
        collMod: name,
        validator: { $jsonSchema: schema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    else
      await this.database.createCollection(name, {
        validator: { $jsonSchema: schema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
  }
  private parseDevice(value: Document) {
    const { _id: ignored, ...document } = value;
    void ignored;
    return NotificationDeviceSchema.parse(document);
  }
  private parseDelivery(value: Document) {
    const { _id: ignored, ...document } = value;
    void ignored;
    return PushDeliverySchema.parse(document);
  }
}
