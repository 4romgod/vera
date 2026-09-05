import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { upgradeLegacyDocumentAnalysis } from '../../../../../src/adapters/outbound/persistence/mongodb/upgrade-legacy-document-analysis.ts';

void describe('legacy document-analysis persistence upgrade', () => {
  void it('upgrades task capability identities, output, references, and evidence kinds', () => {
    const legacy = {
      run: {
        decision: {
          proposal: {
            capability: { name: 'document_analysis', version: 1 },
          },
          decision: {
            reason: 'external_capability_invocation',
            capability: { name: 'document_analysis', version: 1 },
          },
        },
        approval: {
          capability: { name: 'document_analysis', version: 1 },
        },
        approvalHistory: [
          { capability: { name: 'document_analysis', version: 1 } },
        ],
        invocation: {
          capability: { name: 'document_analysis', version: 1 },
        },
        output: {
          kind: 'document_analysis',
          analysis: {
            attachments: [
              { mediaType: 'text/markdown' },
              { mediaType: 'image/png' },
            ],
            citations: [{ locator: 'page 1' }, { attachmentId: 'image' }],
          },
          artifact: {
            type: 'document_analysis',
            mediaType: 'application/vnd.vera.document-analysis+json',
          },
        },
      },
    };

    const upgraded = upgradeLegacyDocumentAnalysis(legacy);

    assert.deepEqual(upgraded, {
      run: {
        decision: {
          proposal: {
            capability: { name: 'attachment_analysis', version: 1 },
          },
          decision: {
            reason: 'specialist_capability_invocation',
            capability: { name: 'attachment_analysis', version: 1 },
          },
        },
        approval: {
          capability: { name: 'attachment_analysis', version: 1 },
        },
        approvalHistory: [
          { capability: { name: 'attachment_analysis', version: 1 } },
        ],
        invocation: {
          capability: { name: 'attachment_analysis', version: 1 },
        },
        output: {
          kind: 'attachment_analysis',
          analysis: {
            attachments: [
              { mediaType: 'text/markdown', kind: 'document' },
              { mediaType: 'image/png', kind: 'image' },
            ],
            citations: [
              { locator: 'page 1', kind: 'document' },
              { attachmentId: 'image', kind: 'image' },
            ],
          },
          artifact: {
            type: 'attachment_analysis',
            mediaType: 'application/vnd.vera.attachment-analysis+json',
          },
        },
      },
    });
    assert.equal(legacy.run.output.kind, 'document_analysis');
  });

  void it('upgrades durable artifacts without changing unrelated values', () => {
    const upgraded = upgradeLegacyDocumentAnalysis({
      type: 'document_analysis',
      mediaType: 'application/vnd.vera.document-analysis+json',
      content: {
        attachments: [{ mediaType: 'text/plain' }],
        citations: [{ locator: 'lines 1-2' }],
      },
    });
    assert.deepEqual(upgraded, {
      type: 'attachment_analysis',
      mediaType: 'application/vnd.vera.attachment-analysis+json',
      content: {
        attachments: [{ mediaType: 'text/plain', kind: 'document' }],
        citations: [{ locator: 'lines 1-2', kind: 'document' }],
      },
    });

    const current = { type: 'research_report', content: { summary: 'safe' } };
    assert.equal(upgradeLegacyDocumentAnalysis(current), current);
  });
});
