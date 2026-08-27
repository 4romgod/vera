import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import { InMemoryAttachmentStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-attachment-store.ts';
import {
  AttachmentRequestError,
  createAttachmentService,
} from '../../../src/application/attachments/attachment-service.ts';
import { assertAttachmentAnalysisCitations } from '../../../src/domain/attachments/attachment-analysis.ts';

function textPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length + 1)}\n`;
  body += '0000000000 65535 f \n';
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const SMALL_HEIC_FIXTURE = Buffer.from(
  'AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAB7G1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAABD2lwcnAAAADtaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAAAEAAAABAAAAChjbGFwAAAABAAAAAEAAAADAAAAAQAAAAAAAAAB/8AAAACAAAAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAnw/iHuRZVNwICBgCogABAAlEAcBhcshEU2QAAAAaaXBtYQAAAAAAAAABAAEHgQIDBoeEhQAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAJgAAAATQACAAAAAQAAAhQAAABMAAAAAW1kYXQAAAAAAAAAqQAAAAZFeGlmAABNTQAqAAAACAADARoABQAAAAEAAAAyARsABQAAAAEAAAA6ASgAAwAAAAEAAgAAAAAAAAAAABkAAAABAAAAGQAAAAEAAABJKAGvo10NRXdznpqlcF/i4wFSrvFf//yl8gUPfsO/8Gdm6uNOc/Ojd3iAn1ZG/7tPRFw7KBrobuP3ppjHZV1+KROd4uwL6ACbgA==',
  'base64',
);

void describe('attachment service', () => {
  void it('scopes deduplication and retrieval to the owner', async () => {
    const store = new InMemoryAttachmentStore();
    let sequence = 0;
    const service = createAttachmentService({
      store,
      createId: () => `attachment_${String(++sequence)}`,
      clock: () => '2026-08-27T00:00:00.000Z',
    });
    const bytes = new TextEncoder().encode('private owner document');

    const ownerOne = await service.upload({
      principalId: 'owner_one',
      filename: 'private.txt',
      mediaType: 'text/plain',
      bytes,
    });
    const ownerTwo = await service.upload({
      principalId: 'owner_two',
      filename: 'private.txt',
      mediaType: 'text/plain',
      bytes,
    });

    assert.notEqual(ownerOne.attachment.id, ownerTwo.attachment.id);
    await assert.rejects(
      service.get('owner_two', ownerOne.attachment.id),
      (error) =>
        error instanceof AttachmentRequestError &&
        error.code === 'attachment_not_found',
    );
  });

  void it('fails closed when durable attachment bytes no longer match the frozen reference', async () => {
    const backing = new InMemoryAttachmentStore();
    const service = createAttachmentService({ store: backing });
    const uploaded = await service.upload({
      principalId: 'owner_one',
      filename: 'evidence.txt',
      mediaType: 'text/plain',
      bytes: new TextEncoder().encode('trusted evidence'),
    });
    const references = await service.resolveReferences('owner_one', [
      uploaded.attachment.id,
    ]);
    const corruptedService = createAttachmentService({
      store: {
        create: backing.create.bind(backing),
        findById: backing.findById.bind(backing),
        readOriginalBytes: () =>
          Promise.resolve(new TextEncoder().encode('tampered')),
        readVisionBytes: backing.readVisionBytes.bind(backing),
        checkReadiness: backing.checkReadiness.bind(backing),
        close: backing.close.bind(backing),
      },
    });

    await assert.rejects(
      corruptedService.loadForAnalysis('owner_one', references),
      (error) =>
        error instanceof AttachmentRequestError &&
        error.code === 'attachment_integrity_failure',
    );
  });

  void it('extracts page-addressable text from a valid PDF', async () => {
    const service = createAttachmentService({
      store: new InMemoryAttachmentStore(),
    });
    const uploaded = await service.upload({
      principalId: 'owner_one',
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: textPdf('Vera PDF evidence'),
    });
    const references = await service.resolveReferences('owner_one', [
      uploaded.attachment.id,
    ]);

    const [loaded] = await service.loadForAnalysis('owner_one', references);
    assert.ok(loaded);
    assert.equal(loaded.attachment.kind, 'document');
    const [segment] = loaded.attachment.extraction.segments;
    assert.ok(segment);

    assert.equal(segment.locator, 'page 1');
    assert.match(segment.text, /Vera PDF evidence/u);
  });

  void it('rejects citations that do not quote an approved extracted segment', async () => {
    const service = createAttachmentService({
      store: new InMemoryAttachmentStore(),
    });
    const uploaded = await service.upload({
      principalId: 'owner_one',
      filename: 'evidence.txt',
      mediaType: 'text/plain',
      bytes: new TextEncoder().encode('Approved evidence only.'),
    });
    const references = await service.resolveReferences('owner_one', [
      uploaded.attachment.id,
    ]);
    const loaded = await service.loadForAnalysis('owner_one', references);

    assert.throws(
      () =>
        assertAttachmentAnalysisCitations(
          {
            summary: 'Unsupported summary.',
            findings: ['Unsupported finding.'],
            citations: [
              {
                kind: 'document',
                attachmentId: uploaded.attachment.id,
                filename: 'evidence.txt',
                locator: 'lines 1-1',
                excerpt: 'Invented evidence.',
              },
            ],
            limitations: [],
          },
          loaded.map(({ attachment }) => attachment),
        ),
      /outside the approved evidence boundary/u,
    );
  });

  void it('preserves long single-line JSON across uniquely addressable segments', async () => {
    const service = createAttachmentService({
      store: new InMemoryAttachmentStore(),
    });
    const text = JSON.stringify({ value: 'x'.repeat(9_000) });
    const uploaded = await service.upload({
      principalId: 'owner_one',
      filename: 'large.json',
      mediaType: 'application/json',
      bytes: new TextEncoder().encode(text),
    });
    const references = await service.resolveReferences('owner_one', [
      uploaded.attachment.id,
    ]);
    const [loaded] = await service.loadForAnalysis('owner_one', references);
    assert.ok(loaded);
    assert.equal(loaded.attachment.kind, 'document');

    assert.equal(
      loaded.attachment.extraction.segments
        .map(({ text: segment }) => segment)
        .join(''),
      text,
    );
    assert.equal(
      new Set(
        loaded.attachment.extraction.segments.map(({ locator }) => locator),
      ).size,
      loaded.attachment.extraction.segments.length,
    );
  });

  void it('normalizes a supported image for vision while retaining its immutable original identity', async () => {
    const service = createAttachmentService({
      store: new InMemoryAttachmentStore(),
      createId: () => 'attachment_image',
      clock: () => '2026-08-27T00:00:00.000Z',
    });
    const original = await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 4,
        background: { r: 220, g: 180, b: 40, alpha: 0.5 },
      },
    })
      .webp()
      .toBuffer();

    const uploaded = await service.upload({
      principalId: 'owner_one',
      filename: 'board.webp',
      mediaType: 'image/webp',
      bytes: original,
    });
    assert.equal(uploaded.attachment.kind, 'image');
    assert.equal(uploaded.attachment.mediaType, 'image/webp');
    assert.equal(uploaded.attachment.vision.mediaType, 'image/png');
    assert.equal(uploaded.attachment.vision.width, 64);
    assert.equal(uploaded.attachment.vision.height, 32);

    const references = await service.resolveReferences('owner_one', [
      uploaded.attachment.id,
    ]);
    const [loaded] = await service.loadForAnalysis('owner_one', references);
    assert.ok(loaded);
    assert.equal(loaded.attachment.kind, 'image');
    if (!('vision' in loaded)) return;
    assert.equal(loaded.vision.mediaType, 'image/png');
    assert.ok(loaded.vision.bytes.byteLength > 0);

    const preview = await service.getImagePreview(
      'owner_one',
      uploaded.attachment.id,
    );
    assert.equal(preview.mediaType, 'image/png');
    assert.deepEqual(preview.bytes, loaded.vision.bytes);
  });

  void it('rejects image bytes that do not match their declared media type', async () => {
    const service = createAttachmentService({
      store: new InMemoryAttachmentStore(),
    });
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    await assert.rejects(
      service.upload({
        principalId: 'owner_one',
        filename: 'fake.jpg',
        mediaType: 'image/jpeg',
        bytes: png,
      }),
      (error) =>
        error instanceof AttachmentRequestError &&
        error.code === 'attachment_content_invalid',
    );
  });

  void it('decodes an iPhone-compatible HEIC in an isolated bounded worker', async () => {
    const service = createAttachmentService({
      store: new InMemoryAttachmentStore(),
    });
    const uploaded = await service.upload({
      principalId: 'owner_one',
      filename: 'phone-photo.heic',
      mediaType: 'image/heic',
      bytes: SMALL_HEIC_FIXTURE,
    });

    assert.equal(uploaded.attachment.kind, 'image');
    assert.equal(uploaded.attachment.mediaType, 'image/heic');
    assert.equal(uploaded.attachment.vision.mediaType, 'image/jpeg');
    assert.equal(uploaded.attachment.vision.width, 4);
    assert.equal(uploaded.attachment.vision.height, 3);
  });
});
