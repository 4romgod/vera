import { z } from 'zod';

export const DocumentAttachmentMediaTypeSchema = z.enum([
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
]);

export const ImageAttachmentMediaTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tiff',
]);

export const SupportedAttachmentMediaTypeSchema = z.union([
  DocumentAttachmentMediaTypeSchema,
  ImageAttachmentMediaTypeSchema,
]);

const AttachmentReferenceIdentitySchema = z
  .object({
    id: z.string().startsWith('attachment_'),
    filename: z.string().trim().min(1).max(255),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const DocumentAttachmentReferenceSchema =
  AttachmentReferenceIdentitySchema.extend({
    kind: z.literal('document').default('document'),
    mediaType: DocumentAttachmentMediaTypeSchema,
  }).strict();

export const ImageAttachmentReferenceSchema =
  AttachmentReferenceIdentitySchema.extend({
    kind: z.literal('image'),
    mediaType: ImageAttachmentMediaTypeSchema,
  }).strict();

export const AttachmentReferenceSchema = z.union([
  DocumentAttachmentReferenceSchema,
  ImageAttachmentReferenceSchema,
]);

export const AttachmentTextSegmentSchema = z
  .object({
    locator: z.string().trim().min(1).max(100),
    text: z.string().min(1).max(20_000),
  })
  .strict();

export const DocumentAttachmentSchema =
  DocumentAttachmentReferenceSchema.extend({
    schemaVersion: z.literal(1),
    principalId: z.string().min(1),
    extraction: z
      .object({
        status: z.literal('ready'),
        extractor: z
          .literal('vera_document_text_v1')
          .default('vera_document_text_v1'),
        totalCharacters: z.number().int().positive().max(120_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        segments: z.array(AttachmentTextSegmentSchema).min(1).max(400),
      })
      .strict(),
    createdAt: z.iso.datetime(),
  }).strict();

export const ImageAttachmentSchema = ImageAttachmentReferenceSchema.extend({
  schemaVersion: z.literal(1),
  principalId: z.string().min(1),
  vision: z
    .object({
      status: z.literal('ready'),
      processor: z.literal('vera_image_vision_v1'),
      mediaType: z.enum(['image/jpeg', 'image/png']),
      byteLength: z
        .number()
        .int()
        .positive()
        .max(12 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      width: z.number().int().positive().max(4_096),
      height: z.number().int().positive().max(4_096),
    })
    .strict(),
  createdAt: z.iso.datetime(),
}).strict();

export const AttachmentSchema = z.union([
  DocumentAttachmentSchema,
  ImageAttachmentSchema,
]);

export const AttachmentResponseSchema = z.union([
  DocumentAttachmentSchema.omit({
    principalId: true,
    extraction: true,
  }).extend({
    extraction: DocumentAttachmentSchema.shape.extraction.omit({
      segments: true,
    }),
  }),
  ImageAttachmentSchema.omit({ principalId: true }),
]);

export type Attachment = z.infer<typeof AttachmentSchema>;
export type DocumentAttachment = z.infer<typeof DocumentAttachmentSchema>;
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;
export type AttachmentReference = z.infer<typeof AttachmentReferenceSchema>;
export type AttachmentResponse = z.infer<typeof AttachmentResponseSchema>;
export type ImageAttachmentMediaType = z.infer<
  typeof ImageAttachmentMediaTypeSchema
>;
