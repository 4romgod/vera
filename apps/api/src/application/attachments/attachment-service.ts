import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

import {
  AttachmentReferenceSchema,
  AttachmentResponseSchema,
  AttachmentSchema,
  type Attachment,
  type AttachmentReference,
  type AttachmentResponse,
  type DocumentAttachment,
  type ImageAttachmentMediaType,
  type ImageAttachment,
} from '../../domain/attachments/attachment.ts';
import type { AttachmentStore } from '../../ports/persistence/attachment-store.ts';

export const MAX_DOCUMENT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = MAX_IMAGE_ATTACHMENT_BYTES;
const MAX_VISION_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_VISION_DIMENSION = 4_096;
const HEIC_DECODE_TIMEOUT_MS = 30_000;
const MAX_EXTRACTED_CHARACTERS = 120_000;
const MAX_SEGMENT_CHARACTERS = 4_000;
const DOCUMENT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
]);
const IMAGE_TYPES = new Set<ImageAttachmentMediaType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tiff',
]);

export type AttachmentRequestErrorCode =
  | 'attachment_empty'
  | 'attachment_too_large'
  | 'attachment_type_unsupported'
  | 'attachment_content_invalid'
  | 'attachment_not_found'
  | 'attachment_integrity_failure';

export class AttachmentRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: AttachmentRequestErrorCode,
  ) {
    super(message);
    this.name = 'AttachmentRequestError';
  }
}

export type AttachmentService = {
  readonly maxAttachmentBytes: number;
  upload(input: {
    principalId: string;
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<{ created: boolean; attachment: AttachmentResponse }>;
  get(principalId: string, attachmentId: string): Promise<AttachmentResponse>;
  getImagePreview(
    principalId: string,
    attachmentId: string,
  ): Promise<{ mediaType: 'image/jpeg' | 'image/png'; bytes: Uint8Array }>;
  resolveReferences(
    principalId: string,
    attachmentIds: readonly string[],
  ): Promise<AttachmentReference[]>;
  loadForAnalysis(
    principalId: string,
    references: readonly AttachmentReference[],
  ): Promise<
    (
      | { attachment: DocumentAttachment }
      | {
          attachment: ImageAttachment;
          vision: { mediaType: 'image/jpeg' | 'image/png'; bytes: Uint8Array };
        }
    )[]
  >;
};

function normalizedMediaType(value: string): string {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function safeFilename(value: string): string {
  const filename =
    value.trim().replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  if (
    filename.length === 0 ||
    filename.length > 255 ||
    filename === '.' ||
    filename === '..'
  ) {
    throw new AttachmentRequestError(
      'The attachment filename is invalid.',
      'attachment_content_invalid',
    );
  }
  return filename;
}

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function chunkText(
  text: string,
  locatorPrefix: 'lines' | 'page',
  page?: number,
) {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const segments: { locator: string; text: string }[] = [];
  let cursor = 0;
  let startLine = 1;
  let segmentNumber = 1;
  const segmented = normalized.length > MAX_SEGMENT_CHARACTERS;
  while (cursor < normalized.length) {
    let end = Math.min(cursor + MAX_SEGMENT_CHARACTERS, normalized.length);
    if (end < normalized.length) {
      const lineBreak = normalized.lastIndexOf('\n', end - 1);
      if (lineBreak >= cursor) end = lineBreak + 1;
    }
    const value = normalized.slice(cursor, end);
    const trimmed = value.trim();
    const lineBreaks = value.match(/\n/gu)?.length ?? 0;
    const endLine = Math.max(
      startLine,
      startLine + lineBreaks - (value.endsWith('\n') ? 1 : 0),
    );
    if (trimmed.length > 0) {
      const baseLocator =
        locatorPrefix === 'page'
          ? `page ${String(page)}`
          : `lines ${String(startLine)}-${String(endLine)}`;
      segments.push({
        locator: segmented
          ? `${baseLocator}, segment ${String(segmentNumber)}`
          : baseLocator,
        text: trimmed,
      });
    }
    cursor = end;
    startLine += lineBreaks;
    segmentNumber += 1;
  }
  return segments;
}

async function extractDocument(bytes: Uint8Array, mediaType: string) {
  if (mediaType !== 'application/pdf') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AttachmentRequestError(
        'The attachment is not valid UTF-8 text.',
        'attachment_content_invalid',
      );
    }
    if (mediaType === 'application/json') {
      try {
        JSON.parse(text);
      } catch {
        throw new AttachmentRequestError(
          'The JSON attachment is malformed.',
          'attachment_content_invalid',
        );
      }
    }
    const bounded = text.trim().slice(0, MAX_EXTRACTED_CHARACTERS);
    if (bounded.length === 0) {
      throw new AttachmentRequestError(
        'The attachment contains no readable text.',
        'attachment_empty',
      );
    }
    return chunkText(bounded, 'lines');
  }

  if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new AttachmentRequestError(
      'The uploaded file is not a valid PDF.',
      'attachment_content_invalid',
    );
  }
  try {
    const loadingTask = getDocument({
      data: Uint8Array.from(bytes),
      useWorkerFetch: false,
      useSystemFonts: true,
    });
    try {
      const pdf = await loadingTask.promise;
      const segments: { locator: string; text: string }[] = [];
      let characters = 0;
      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages && characters < MAX_EXTRACTED_CHARACTERS;
        pageNumber += 1
      ) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, MAX_EXTRACTED_CHARACTERS - characters);
        characters += text.length;
        if (text.length > 0)
          segments.push(...chunkText(text, 'page', pageNumber));
      }
      if (segments.length === 0) {
        throw new AttachmentRequestError(
          'The PDF contains no extractable text; scanned-image OCR is not enabled.',
          'attachment_content_invalid',
        );
      }
      return segments;
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof AttachmentRequestError) throw error;
    throw new AttachmentRequestError(
      'Vera could not read the PDF.',
      'attachment_content_invalid',
    );
  }
}

function imageFormatMediaType(
  format: string | undefined,
  detectedMediaType: string | undefined,
  declared: ImageAttachmentMediaType,
): ImageAttachmentMediaType | undefined {
  if (IMAGE_TYPES.has(detectedMediaType as ImageAttachmentMediaType)) {
    return detectedMediaType as ImageAttachmentMediaType;
  }
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'avif':
      return 'image/avif';
    case 'tiff':
      return 'image/tiff';
    case 'heif':
      return declared === 'image/heic' ? 'image/heic' : 'image/heif';
    default:
      return undefined;
  }
}

const heicConvertModulePath = createRequire(import.meta.url).resolve(
  'heic-convert',
);

function decodeHeicInWorker(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        const convert = require(workerData.modulePath);
        convert({ buffer: workerData.bytes, format: 'JPEG', quality: 1 })
          .then((value) => parentPort.postMessage(value))
          .catch((error) => { throw error; });
      `,
      {
        eval: true,
        workerData: {
          modulePath: heicConvertModulePath,
          bytes: Buffer.from(bytes),
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 384,
          maxYoungGenerationSizeMb: 64,
          stackSizeMb: 4,
        },
      },
    );
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
      void worker.terminate();
    };
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new Error('HEIC decoding exceeded its time limit.')),
        ),
      HEIC_DECODE_TIMEOUT_MS,
    );
    timeout.unref();
    worker.once('message', (value: Uint8Array) =>
      finish(() => resolve(Uint8Array.from(value))),
    );
    worker.once('error', (error: unknown) =>
      finish(() =>
        reject(error instanceof Error ? error : new Error(String(error))),
      ),
    );
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish(() =>
          reject(new Error(`HEIC decoder exited with code ${String(code)}.`)),
        );
      }
    });
  });
}

async function prepareImage(
  bytes: Uint8Array,
  declared: ImageAttachmentMediaType,
) {
  try {
    let processBytes = bytes;
    let heicFallback = false;
    let metadata;
    try {
      metadata = await sharp(processBytes, {
        animated: false,
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
        pages: 1,
      }).metadata();
    } catch (error) {
      if (declared !== 'image/heic' && declared !== 'image/heif') throw error;
      processBytes = await decodeHeicInWorker(bytes);
      heicFallback = true;
      metadata = await sharp(processBytes, {
        animated: false,
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
        pages: 1,
      }).metadata();
    }
    if (
      !heicFallback &&
      (declared === 'image/heic' || declared === 'image/heif') &&
      metadata.compression === 'hevc'
    ) {
      processBytes = await decodeHeicInWorker(bytes);
      heicFallback = true;
      metadata = await sharp(processBytes, {
        animated: false,
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
        pages: 1,
      }).metadata();
    }
    const actualMediaType = heicFallback
      ? declared
      : imageFormatMediaType(metadata.format, metadata.mediaType, declared);
    if (actualMediaType === undefined) {
      throw new AttachmentRequestError(
        'The uploaded bytes are not a supported image.',
        'attachment_content_invalid',
      );
    }
    const sameDeclaredFormat =
      actualMediaType === declared ||
      (['image/heic', 'image/heif'].includes(actualMediaType) &&
        ['image/heic', 'image/heif'].includes(declared));
    if (!sameDeclaredFormat) {
      throw new AttachmentRequestError(
        `The declared image type ${declared} does not match the uploaded bytes (${actualMediaType}).`,
        'attachment_content_invalid',
      );
    }
    const pipeline = sharp(processBytes, {
      animated: false,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    })
      .rotate()
      .resize({
        width: MAX_VISION_DIMENSION,
        height: MAX_VISION_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toColorspace('srgb');
    const normalized = metadata.hasAlpha
      ? await pipeline
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer({ resolveWithObject: true })
      : await pipeline
          .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
          .toBuffer({ resolveWithObject: true });
    if (normalized.data.byteLength > MAX_VISION_BYTES) {
      throw new AttachmentRequestError(
        'The normalized image is too large for safe vision analysis.',
        'attachment_too_large',
      );
    }
    const normalizedMediaType = metadata.hasAlpha
      ? ('image/png' as const)
      : ('image/jpeg' as const);
    return {
      mediaType: normalizedMediaType,
      originalMediaType: actualMediaType,
      bytes: Uint8Array.from(normalized.data),
      width: normalized.info.width,
      height: normalized.info.height,
    };
  } catch (error) {
    if (error instanceof AttachmentRequestError) throw error;
    throw new AttachmentRequestError(
      'Vera could not decode the image.',
      'attachment_content_invalid',
    );
  }
}

function response(attachment: Attachment): AttachmentResponse {
  if (attachment.kind === 'image') {
    const { principalId: ignoredPrincipal, ...identity } = attachment;
    void ignoredPrincipal;
    return AttachmentResponseSchema.parse(identity);
  }
  const { principalId: ignoredPrincipal, extraction, ...identity } = attachment;
  void ignoredPrincipal;
  return AttachmentResponseSchema.parse({
    ...identity,
    extraction: {
      status: extraction.status,
      extractor: extraction.extractor,
      totalCharacters: extraction.totalCharacters,
      sha256: extraction.sha256,
    },
  });
}

function reference(attachment: Attachment): AttachmentReference {
  return AttachmentReferenceSchema.parse({
    id: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
  });
}

export function createAttachmentService(options: {
  store: AttachmentStore;
  clock?: () => string;
  createId?: () => string;
}): AttachmentService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => `attachment_${randomUUID()}`);
  return {
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    async upload(input) {
      if (input.bytes.byteLength === 0) {
        throw new AttachmentRequestError(
          'The attachment is empty.',
          'attachment_empty',
        );
      }
      const declaredMediaType = normalizedMediaType(input.mediaType);
      const isDocument = DOCUMENT_TYPES.has(declaredMediaType);
      const isImage = IMAGE_TYPES.has(
        declaredMediaType as ImageAttachmentMediaType,
      );
      if (!isDocument && !isImage) {
        throw new AttachmentRequestError(
          `Attachment type "${declaredMediaType || 'unknown'}" is not supported.`,
          'attachment_type_unsupported',
        );
      }
      const byteLimit = isImage
        ? MAX_IMAGE_ATTACHMENT_BYTES
        : MAX_DOCUMENT_ATTACHMENT_BYTES;
      if (input.bytes.byteLength > byteLimit) {
        throw new AttachmentRequestError(
          `The attachment exceeds Vera's ${String(byteLimit)} byte limit for this media type.`,
          'attachment_too_large',
        );
      }
      const common = {
        schemaVersion: 1 as const,
        id: createId(),
        principalId: input.principalId,
        filename: safeFilename(input.filename),
        byteLength: input.bytes.byteLength,
        sha256: digest(input.bytes),
        createdAt: clock(),
      };
      let attachment: Attachment;
      let visionBytes: Uint8Array | undefined;
      if (isImage) {
        const prepared = await prepareImage(
          input.bytes,
          declaredMediaType as ImageAttachmentMediaType,
        );
        visionBytes = prepared.bytes;
        attachment = AttachmentSchema.parse({
          ...common,
          kind: 'image',
          mediaType: prepared.originalMediaType,
          vision: {
            status: 'ready',
            processor: 'vera_image_vision_v1',
            mediaType: prepared.mediaType,
            byteLength: prepared.bytes.byteLength,
            sha256: digest(prepared.bytes),
            width: prepared.width,
            height: prepared.height,
          },
        });
      } else {
        const segments = await extractDocument(input.bytes, declaredMediaType);
        const extractedText = segments
          .map((segment) => `${segment.locator}\n${segment.text}`)
          .join('\n\n');
        attachment = AttachmentSchema.parse({
          ...common,
          kind: 'document',
          mediaType: declaredMediaType,
          extraction: {
            status: 'ready',
            extractor: 'vera_document_text_v1',
            totalCharacters: segments.reduce(
              (total, segment) => total + segment.text.length,
              0,
            ),
            sha256: digest(extractedText),
            segments,
          },
        });
      }
      const stored = await options.store.create(attachment, {
        original: input.bytes,
        ...(visionBytes === undefined ? {} : { vision: visionBytes }),
      });
      return {
        created: stored.created,
        attachment: response(stored.attachment),
      };
    },
    async get(principalId, attachmentId) {
      const attachment = await options.store.findById(
        principalId,
        attachmentId,
      );
      if (attachment === null) {
        throw new AttachmentRequestError(
          `Attachment ${attachmentId} was not found.`,
          'attachment_not_found',
        );
      }
      return response(attachment);
    },
    async getImagePreview(principalId, attachmentId) {
      const attachment = await options.store.findById(
        principalId,
        attachmentId,
      );
      const bytes = await options.store.readVisionBytes(
        principalId,
        attachmentId,
      );
      if (attachment === null) {
        throw new AttachmentRequestError(
          `Attachment ${attachmentId} was not found.`,
          'attachment_not_found',
        );
      }
      if (attachment.kind !== 'image' || bytes === null) {
        throw new AttachmentRequestError(
          `Attachment ${attachmentId} has no image preview.`,
          'attachment_content_invalid',
        );
      }
      if (
        bytes.byteLength !== attachment.vision.byteLength ||
        digest(bytes) !== attachment.vision.sha256
      ) {
        throw new AttachmentRequestError(
          `Attachment ${attachmentId} preview failed integrity validation.`,
          'attachment_integrity_failure',
        );
      }
      return { mediaType: attachment.vision.mediaType, bytes };
    },
    async resolveReferences(principalId, attachmentIds) {
      const unique = [...new Set(attachmentIds)];
      if (unique.length !== attachmentIds.length || unique.length > 5) {
        throw new AttachmentRequestError(
          'Attachment references must be unique and limited to five.',
          'attachment_content_invalid',
        );
      }
      return Promise.all(
        unique.map(async (id) => {
          const attachment = await options.store.findById(principalId, id);
          if (attachment === null) {
            throw new AttachmentRequestError(
              `Attachment ${id} was not found.`,
              'attachment_not_found',
            );
          }
          return reference(attachment);
        }),
      );
    },
    async loadForAnalysis(principalId, references) {
      return Promise.all(
        references.map(async (frozenReference) => {
          const attachment = await options.store.findById(
            principalId,
            frozenReference.id,
          );
          const originalBytes = await options.store.readOriginalBytes(
            principalId,
            frozenReference.id,
          );
          if (
            attachment === null ||
            originalBytes === null ||
            JSON.stringify(reference(attachment)) !==
              JSON.stringify(frozenReference) ||
            originalBytes.byteLength !== attachment.byteLength ||
            digest(originalBytes) !== attachment.sha256
          ) {
            throw new AttachmentRequestError(
              `Attachment ${frozenReference.id} failed integrity validation.`,
              'attachment_integrity_failure',
            );
          }
          if (attachment.kind === 'image') {
            const visionBytes = await options.store.readVisionBytes(
              principalId,
              frozenReference.id,
            );
            if (
              visionBytes?.byteLength !== attachment.vision.byteLength ||
              digest(visionBytes) !== attachment.vision.sha256
            ) {
              throw new AttachmentRequestError(
                `Attachment ${frozenReference.id} vision representation failed integrity validation.`,
                'attachment_integrity_failure',
              );
            }
            return {
              attachment,
              vision: {
                mediaType: attachment.vision.mediaType,
                bytes: visionBytes,
              },
            };
          }
          const extractionText = attachment.extraction.segments
            .map((segment) => `${segment.locator}\n${segment.text}`)
            .join('\n\n');
          if (digest(extractionText) !== attachment.extraction.sha256) {
            throw new AttachmentRequestError(
              `Attachment ${frozenReference.id} extraction failed integrity validation.`,
              'attachment_integrity_failure',
            );
          }
          return { attachment };
        }),
      );
    },
  };
}
