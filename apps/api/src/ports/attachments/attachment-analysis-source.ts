import type {
  AttachmentReference,
  DocumentAttachment,
  ImageAttachment,
} from '../../domain/attachments/attachment.ts';

export type LoadedAttachmentForAnalysis =
  | { attachment: DocumentAttachment }
  | {
      attachment: ImageAttachment;
      vision: { mediaType: 'image/jpeg' | 'image/png'; bytes: Uint8Array };
    };

export type AttachmentAnalysisSource = {
  loadForAnalysis(
    principalId: string,
    references: readonly AttachmentReference[],
  ): Promise<LoadedAttachmentForAnalysis[]>;
};
