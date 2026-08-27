import type { Attachment } from '../../domain/attachments/attachment.ts';

export type AttachmentStore = {
  create(
    attachment: Attachment,
    bytes: { original: Uint8Array; vision?: Uint8Array },
  ): Promise<{ created: boolean; attachment: Attachment }>;
  findById(
    principalId: string,
    attachmentId: string,
  ): Promise<Attachment | null>;
  readOriginalBytes(
    principalId: string,
    attachmentId: string,
  ): Promise<Uint8Array | null>;
  readVisionBytes(
    principalId: string,
    attachmentId: string,
  ): Promise<Uint8Array | null>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
