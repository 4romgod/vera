import {
  GridFSBucket,
  MongoClient,
  ObjectId,
  type Collection,
  type Db,
  type Document,
} from 'mongodb';

import {
  AttachmentSchema,
  type Attachment,
} from '../../../../domain/attachments/attachment.ts';
import type { AttachmentStore } from '../../../../ports/persistence/attachment-store.ts';

export class MongoDbAttachmentStore implements AttachmentStore {
  private readonly client: MongoClient;
  private readonly database: Db;
  private readonly metadata: Collection;
  private readonly bucket: GridFSBucket;
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
    this.metadata = this.database.collection('attachments');
    this.bucket = new GridFSBucket(this.database, {
      bucketName: 'attachment_blobs',
    });
  }

  public async create(
    attachment: Attachment,
    bytes: { original: Uint8Array; vision?: Uint8Array },
  ) {
    await this.ensureConnected();
    const existing = await this.metadata.findOne({
      principalId: attachment.principalId,
      sha256: attachment.sha256,
    });
    if (existing !== null) {
      return { created: false, attachment: this.parseAttachment(existing) };
    }
    const originalBlobId = new ObjectId();
    await this.uploadBlob(
      originalBlobId,
      attachment.filename,
      attachment.principalId,
      attachment.sha256,
      'original',
      bytes.original,
    );
    if ((attachment.kind === 'image') !== (bytes.vision !== undefined)) {
      await this.bucket.delete(originalBlobId).catch(() => undefined);
      throw new Error(
        'Image attachments require exactly one normalized vision representation.',
      );
    }
    const visionBytes = bytes.vision;
    const visionBlobId = visionBytes === undefined ? undefined : new ObjectId();
    if (
      visionBlobId !== undefined &&
      visionBytes !== undefined &&
      attachment.kind === 'image'
    ) {
      try {
        await this.uploadBlob(
          visionBlobId,
          attachment.filename,
          attachment.principalId,
          attachment.vision.sha256,
          'vision',
          visionBytes,
        );
      } catch (error) {
        await this.bucket.delete(originalBlobId).catch(() => undefined);
        throw error;
      }
    }
    try {
      await this.metadata.insertOne({
        ...attachment,
        originalBlobId,
        ...(visionBlobId === undefined ? {} : { visionBlobId }),
      });
      return { created: true, attachment };
    } catch (error) {
      await Promise.all([
        this.bucket.delete(originalBlobId).catch(() => undefined),
        ...(visionBlobId === undefined
          ? []
          : [this.bucket.delete(visionBlobId).catch(() => undefined)]),
      ]);
      const raced = await this.metadata.findOne({
        principalId: attachment.principalId,
        sha256: attachment.sha256,
      });
      if (raced !== null) {
        return { created: false, attachment: this.parseAttachment(raced) };
      }
      throw error;
    }
  }

  public async findById(principalId: string, attachmentId: string) {
    await this.ensureConnected();
    const document = await this.metadata.findOne({
      principalId,
      id: attachmentId,
    });
    return document === null ? null : this.parseAttachment(document);
  }

  public async readOriginalBytes(principalId: string, attachmentId: string) {
    await this.ensureConnected();
    const document = await this.metadata.findOne({
      principalId,
      id: attachmentId,
    });
    const blobId =
      document?.originalBlobId instanceof ObjectId
        ? document.originalBlobId
        : document?.blobId instanceof ObjectId
          ? document.blobId
          : undefined;
    if (document === null || blobId === undefined) return null;
    const attachment = this.parseAttachment(document);
    return this.downloadBlob(blobId, attachment.byteLength);
  }

  public async readVisionBytes(principalId: string, attachmentId: string) {
    await this.ensureConnected();
    const document = await this.metadata.findOne({
      principalId,
      id: attachmentId,
    });
    if (document === null || !(document.visionBlobId instanceof ObjectId)) {
      return null;
    }
    const attachment = this.parseAttachment(document);
    if (attachment.kind !== 'image') return null;
    return this.downloadBlob(
      document.visionBlobId,
      attachment.vision.byteLength,
    );
  }

  private downloadBlob(blobId: ObjectId, expectedByteLength: number) {
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const stream = this.bucket.openDownloadStream(blobId);
      stream.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > expectedByteLength) {
          stream.destroy(
            new Error('Attachment blob exceeds its durable byte length.'),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private uploadBlob(
    id: ObjectId,
    filename: string,
    principalId: string,
    sha256: string,
    representation: 'original' | 'vision',
    bytes: Uint8Array,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const stream = this.bucket.openUploadStreamWithId(id, filename, {
        metadata: { principalId, sha256, representation },
      });
      stream.once('error', reject);
      stream.once('finish', () => resolve());
      stream.end(Buffer.from(bytes));
    });
  }

  public async checkReadiness(): Promise<void> {
    await this.ensureConnected();
    await this.database.command({ ping: 1 });
  }
  public async close(): Promise<void> {
    await this.client.close();
  }

  private ensureConnected(): Promise<void> {
    return (this.connection ??= this.connect().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    }));
  }
  private async connect(): Promise<void> {
    await this.client.connect();
    await Promise.all([
      this.metadata.createIndex({ id: 1 }, { unique: true }),
      this.metadata.createIndex(
        { principalId: 1, sha256: 1 },
        { unique: true },
      ),
      this.metadata.createIndex({ principalId: 1, createdAt: -1 }),
    ]);
  }

  private parseAttachment(document: Document): Attachment {
    const {
      _id: ignoredId,
      blobId: ignoredLegacyBlobId,
      originalBlobId: ignoredOriginalBlobId,
      visionBlobId: ignoredVisionBlobId,
      ...value
    } = document;
    void ignoredId;
    void ignoredLegacyBlobId;
    void ignoredOriginalBlobId;
    void ignoredVisionBlobId;
    return AttachmentSchema.parse(value);
  }
}
