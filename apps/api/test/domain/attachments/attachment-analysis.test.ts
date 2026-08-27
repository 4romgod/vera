import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AttachmentAnalysisContentSchema,
  AttachmentAnalysisModelContentSchema,
  cleanAttachmentAnalysisProse,
} from '../../../src/domain/attachments/attachment-analysis.ts';

void describe('attachment analysis model content', () => {
  void it('rejects punctuation-only findings from a model', () => {
    const parsed = AttachmentAnalysisModelContentSchema.safeParse({
      summary: 'The approved screenshot contains a visible error.',
      findings: ['],'],
      citations: [{ sourceId: 'source_1' }],
      limitations: [],
    });

    assert.equal(parsed.success, false);
  });

  void it('keeps an already-persisted legacy finding readable', () => {
    const parsed = AttachmentAnalysisContentSchema.safeParse({
      summary: 'The approved screenshot contains a visible error.',
      findings: ['],'],
      citations: [
        {
          kind: 'image',
          attachmentId: 'attachment_legacy',
          filename: 'legacy.png',
        },
      ],
      limitations: [],
    });

    assert.equal(parsed.success, true);
  });

  void it('accepts complete evidence-backed prose', () => {
    const parsed = AttachmentAnalysisModelContentSchema.safeParse({
      summary: 'The approved screenshot contains a visible recording error.',
      findings: [
        'The recording failure prevents the owner from reviewing or submitting the spoken message.',
      ],
      citations: [{ sourceId: 'source_1' }],
      limitations: ['The screenshot does not expose the underlying cause.'],
    });

    assert.equal(parsed.success, true);
  });

  void it('removes internal source markers from owner-facing prose', () => {
    assert.equal(
      cleanAttachmentAnalysisProse(
        'The recording failed. (source_1) This blocks submission (SOURCE_12).',
      ),
      'The recording failed. This blocks submission.',
    );
  });
});
