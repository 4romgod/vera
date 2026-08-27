import { z } from 'zod';

import type { Attachment } from './attachment.ts';

function meaningfulText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => /[\p{L}\p{N}]/u.test(value), {
      message: 'Text must contain at least one letter or number.',
    });
}

export const AttachmentAnalysisArgumentsSchema = z
  .object({
    objective: z.string().trim().min(1).max(10_000),
  })
  .strict();

const CitationIdentitySchema = z
  .object({
    attachmentId: z.string().startsWith('attachment_'),
    filename: z.string().trim().min(1).max(255),
  })
  .strict();

export const AttachmentAnalysisCitationSchema = z.union([
  CitationIdentitySchema.extend({
    kind: z.literal('document'),
    locator: z.string().trim().min(1).max(100),
    excerpt: z.string().trim().min(1).max(500),
  }).strict(),
  CitationIdentitySchema.extend({ kind: z.literal('image') }).strict(),
]);

export const AttachmentAnalysisContentSchema = z
  .object({
    summary: z.string().trim().min(1).max(5_000),
    findings: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
    citations: z.array(AttachmentAnalysisCitationSchema).min(1).max(100),
    limitations: z.array(z.string().trim().min(1).max(1_000)).max(20),
  })
  .strict();

export const AttachmentAnalysisModelContentSchema = z
  .object({
    summary: meaningfulText(5_000).describe(
      'A complete plain-language summary grounded only in the supplied sources.',
    ),
    findings: z
      .array(
        meaningfulText(2_000).describe(
          'One complete plain-language evidence-backed finding, not a fragment or punctuation.',
        ),
      )
      .min(1)
      .max(30),
    citations: z
      .array(
        z
          .object({ sourceId: z.string().regex(/^source_[1-9][0-9]*$/) })
          .strict(),
      )
      .min(1)
      .max(100),
    limitations: z
      .array(
        meaningfulText(1_000).describe(
          'One complete plain-language limitation of the available evidence.',
        ),
      )
      .max(20),
  })
  .strict();

export const AttachmentAnalysisSchema = AttachmentAnalysisContentSchema.extend({
  schemaVersion: z.literal(1),
  objective: AttachmentAnalysisArgumentsSchema.shape.objective,
  attachments: z
    .array(
      z
        .object({
          id: z.string().startsWith('attachment_'),
          kind: z.enum(['document', 'image']),
          filename: z.string().trim().min(1).max(255),
          mediaType: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    )
    .min(1)
    .max(5),
  analyzedAt: z.iso.datetime(),
}).strict();

export const AttachmentAnalysisModelContentJsonSchema = z.toJSONSchema(
  AttachmentAnalysisModelContentSchema,
  { target: 'draft-7' },
);

export type AttachmentAnalysis = z.infer<typeof AttachmentAnalysisSchema>;
export type AttachmentAnalysisContent = z.infer<
  typeof AttachmentAnalysisContentSchema
>;

export function cleanAttachmentAnalysisProse(value: string): string {
  return value
    .replace(/\s*\(?source_[1-9][0-9]*\)?/giu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();
}

export function assertAttachmentAnalysisCitations(
  content: AttachmentAnalysisContent,
  attachments: readonly Attachment[],
): void {
  const byId = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  for (const citation of content.citations) {
    const attachment = byId.get(citation.attachmentId);
    if (
      attachment?.filename !== citation.filename ||
      attachment.kind !== citation.kind
    ) {
      throw new Error(
        'Attachment analysis returned a citation outside the approved evidence boundary.',
      );
    }
    if (citation.kind === 'document') {
      if (attachment.kind !== 'document') {
        throw new Error(
          'Attachment analysis returned an invalid document citation.',
        );
      }
      const segment = attachment.extraction.segments.find(
        (candidate) => candidate.locator === citation.locator,
      );
      if (!segment?.text.includes(citation.excerpt)) {
        throw new Error(
          'Attachment analysis returned a document citation outside the approved evidence boundary.',
        );
      }
    }
  }
}
