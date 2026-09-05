import type { Document } from 'mongodb';

type MutableDocument = Record<string, unknown>;

function record(value: unknown): MutableDocument | undefined {
  return typeof value === 'object' && value !== null
    ? (value as MutableDocument)
    : undefined;
}

function unknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? (value as unknown[]) : undefined;
}

function renameCapability(value: unknown): unknown {
  const source = record(value);
  if (source?.name !== 'document_analysis') return value;
  return { ...source, name: 'attachment_analysis' };
}

function upgradeInvocationShape(value: unknown): unknown {
  const source = record(value);
  if (source === undefined) return value;
  return {
    ...source,
    ...(source.reason === 'external_capability_invocation'
      ? { reason: 'specialist_capability_invocation' }
      : {}),
    ...(source.capability === undefined
      ? {}
      : { capability: renameCapability(source.capability) }),
  };
}

function upgradeDecisionRecord(value: unknown): unknown {
  const source = record(value);
  if (source === undefined) return value;
  return {
    ...source,
    ...(source.proposal === undefined
      ? {}
      : { proposal: upgradeInvocationShape(source.proposal) }),
    ...(source.decision === undefined
      ? {}
      : { decision: upgradeInvocationShape(source.decision) }),
  };
}

function upgradeAnalysis(value: unknown): unknown {
  const source = record(value);
  if (source === undefined) return value;
  const attachments = unknownArray(source.attachments);
  const citations = unknownArray(source.citations);
  return {
    ...source,
    ...(attachments === undefined
      ? {}
      : {
          attachments: attachments.map((attachment) => {
            const item = record(attachment);
            if (item === undefined || item.kind !== undefined)
              return attachment;
            return {
              ...item,
              kind:
                typeof item.mediaType === 'string' &&
                item.mediaType.startsWith('image/')
                  ? 'image'
                  : 'document',
            };
          }),
        }),
    ...(citations === undefined
      ? {}
      : {
          citations: citations.map((citation) => {
            const item = record(citation);
            if (item === undefined || item.kind !== undefined) return citation;
            return {
              ...item,
              kind: item.locator === undefined ? 'image' : 'document',
            };
          }),
        }),
  };
}

function upgradeOutput(value: unknown): unknown {
  const source = record(value);
  if (source?.kind !== 'document_analysis') return value;
  const artifact = record(source.artifact);
  return {
    ...source,
    kind: 'attachment_analysis',
    analysis: upgradeAnalysis(source.analysis),
    ...(artifact === undefined
      ? {}
      : {
          artifact: {
            ...artifact,
            type: 'attachment_analysis',
            mediaType: 'application/vnd.vera.attachment-analysis+json',
          },
        }),
  };
}

function upgradeTaskAggregate(document: MutableDocument): Document {
  const run = record(document.run);
  if (run === undefined) return document;
  const approvalHistory = unknownArray(run.approvalHistory);
  return {
    ...document,
    run: {
      ...run,
      ...(run.decision === undefined
        ? {}
        : { decision: upgradeDecisionRecord(run.decision) }),
      ...(run.approval === undefined
        ? {}
        : { approval: upgradeInvocationShape(run.approval) }),
      ...(approvalHistory === undefined
        ? {}
        : {
            approvalHistory: approvalHistory.map(upgradeInvocationShape),
          }),
      ...(run.invocation === undefined
        ? {}
        : { invocation: upgradeInvocationShape(run.invocation) }),
      ...(run.output === undefined
        ? {}
        : { output: upgradeOutput(run.output) }),
    },
  };
}

function upgradeArtifact(document: MutableDocument): Document {
  if (document.type !== 'document_analysis') return document;
  return {
    ...document,
    type: 'attachment_analysis',
    mediaType: 'application/vnd.vera.attachment-analysis+json',
    content: upgradeAnalysis(document.content),
  };
}

/** Presents superseded capability persistence contracts as current v1 data. */
export function upgradeLegacyDocumentAnalysis(document: Document): Document {
  const upgraded = upgradeTaskAggregate(document);
  return upgradeArtifact(upgraded);
}
