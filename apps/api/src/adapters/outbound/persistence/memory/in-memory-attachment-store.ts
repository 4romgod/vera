import type { Attachment } from '../../../../domain/attachments/attachment.ts';
import type { AttachmentStore } from '../../../../ports/persistence/attachment-store.ts';

export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly attachments = new Map<string, Attachment>();
  private readonly originalBytes = new Map<string, Uint8Array>();
  private readonly visionBytes = new Map<string, Uint8Array>();
  private readonly idByOwnerHash = new Map<string, string>();

  public create(
    attachment: Attachment,
    bytes: { original: Uint8Array; vision?: Uint8Array },
  ) {
    const hashKey = `${attachment.principalId}:${attachment.sha256}`;
    const existingId = this.idByOwnerHash.get(hashKey);
    if (existingId !== undefined) {
      const existing = this.attachments.get(existingId);
      if (existing === undefined)
        throw new Error('Attachment index is inconsistent.');
      return Promise.resolve({
        created: false,
        attachment: structuredClone(existing),
      });
    }
    this.idByOwnerHash.set(hashKey, attachment.id);
    this.attachments.set(attachment.id, structuredClone(attachment));
    this.originalBytes.set(attachment.id, Uint8Array.from(bytes.original));
    if (bytes.vision !== undefined) {
      this.visionBytes.set(attachment.id, Uint8Array.from(bytes.vision));
    }
    return Promise.resolve({
      created: true,
      attachment: structuredClone(attachment),
    });
  }

  public findById(principalId: string, attachmentId: string) {
    const attachment = this.attachments.get(attachmentId);
    return Promise.resolve(
      attachment?.principalId === principalId
        ? structuredClone(attachment)
        : null,
    );
  }

  public readOriginalBytes(principalId: string, attachmentId: string) {
    const attachment = this.attachments.get(attachmentId);
    const bytes = this.originalBytes.get(attachmentId);
    return Promise.resolve(
      attachment?.principalId === principalId && bytes !== undefined
        ? Uint8Array.from(bytes)
        : null,
    );
  }

  public readVisionBytes(principalId: string, attachmentId: string) {
    const attachment = this.attachments.get(attachmentId);
    const bytes = this.visionBytes.get(attachmentId);
    return Promise.resolve(
      attachment?.principalId === principalId && bytes !== undefined
        ? Uint8Array.from(bytes)
        : null,
    );
  }

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }
  public close(): Promise<void> {
    return Promise.resolve();
  }
}
