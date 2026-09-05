import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OpenAPIV3 } from 'openapi-types';

import { createOpenApiDocument } from '../../../../src/adapters/inbound/http/openapi-document.ts';

const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

function operations(document: OpenAPIV3.Document) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    pathItem === undefined
      ? []
      : methods.flatMap((method) => {
          const operation = pathItem[method];
          return operation === undefined ? [] : [{ method, path, operation }];
        }),
  );
}

void describe('generated OpenAPI contract', () => {
  void it('documents the complete production route graph', async () => {
    const document = await createOpenApiDocument();
    const documented = operations(document);

    assert.equal(document.openapi, '3.1.0');
    assert.equal(Object.keys(document.paths).length, 78);
    assert.equal(documented.length, 90);
    assert.equal(
      new Set(documented.map(({ operation }) => operation.operationId)).size,
      90,
    );
    const componentNames = Object.keys(document.components?.schemas ?? {});
    for (const componentName of [
      'DateTime',
      'AttachmentAnalysisInvocationDecision',
      'CapabilityCatalogResource',
      'MachineCatalogResource',
      'ProjectResource',
      'ConversationResource',
      'TaskResource',
      'ArtifactResource',
      'MemoryResource',
      'AttentionBriefing',
      'DevelopmentCampaignResource',
      'MissionResource',
      'RoutineRunResource',
      'IntegrationCatalogResource',
      'IntegrationConnectionResource',
      'ExternalSignalListResource',
    ]) {
      assert.ok(
        componentNames.includes(componentName),
        `missing stable component name ${componentName}`,
      );
    }
    assert.ok(componentNames.every((name) => !name.startsWith('Shared')));
    assert.ok(documented.some(({ path }) => path === '/health'));
    assert.ok(documented.some(({ path }) => path === '/ready'));

    for (const { method, path, operation } of documented) {
      assert.ok(
        operation.operationId,
        `${method} ${path} needs an operationId`,
      );
      assert.equal(
        operation.tags?.length,
        1,
        `${method} ${path} needs one tag`,
      );
      assert.ok(
        Object.keys(operation.responses).some((status) =>
          status.startsWith('2'),
        ),
        `${method} ${path} needs a successful response`,
      );
      assert.ok(
        operation.responses['500'],
        `${method} ${path} needs its error envelope`,
      );
    }
  });

  void it('documents non-JSON transports and resumable streaming', async () => {
    const document = await createOpenApiDocument();
    const attachment = document.paths['/v1/attachments']?.post;
    const transcription = document.paths['/v1/audio/transcriptions']?.post;
    const preview = document.paths['/v1/attachments/{id}/preview']?.get;
    const stream = document.paths['/v1/notifications/stream']?.get;

    assert.ok(
      attachment?.requestBody !== undefined &&
        !('$ref' in attachment.requestBody),
    );
    assert.ok(attachment.requestBody.content['application/octet-stream']);
    assert.ok(
      transcription?.requestBody !== undefined &&
        !('$ref' in transcription.requestBody),
    );
    assert.deepEqual(Object.keys(transcription.requestBody.content), [
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
    ]);
    assert.ok(
      preview?.responses['200'] !== undefined &&
        !('$ref' in preview.responses['200']) &&
        preview.responses['200'].content?.['image/jpeg'],
    );
    assert.ok(
      stream?.responses['200'] !== undefined &&
        !('$ref' in stream.responses['200']) &&
        stream.responses['200'].content?.['text/event-stream'],
    );
    assert.ok(
      stream.parameters?.some(
        (parameter) =>
          !('$ref' in parameter) && parameter.name === 'Last-Event-ID',
      ),
    );
  });

  void it('documents validation, lifecycle, upload, and provider failures', async () => {
    const document = await createOpenApiDocument();
    const task = document.paths['/v1/tasks']?.post;
    const upload = document.paths['/v1/attachments']?.post;
    const approval = document.paths['/v1/approvals/{id}/decision']?.post;

    assert.deepEqual(Object.keys(task?.responses ?? {}), [
      '202',
      '400',
      '404',
      '409',
      '500',
    ]);
    assert.deepEqual(Object.keys(upload?.responses ?? {}), [
      '200',
      '201',
      '400',
      '413',
      '415',
      '422',
      '500',
    ]);
    assert.deepEqual(Object.keys(approval?.responses ?? {}), [
      '202',
      '400',
      '404',
      '409',
      '500',
    ]);
    assert.ok(
      upload?.responses['200'] !== undefined &&
        !('$ref' in upload.responses['200']) &&
        upload.responses['200'].headers?.Location,
    );
    assert.ok(
      task?.responses['202'] !== undefined &&
        !('$ref' in task.responses['202']) &&
        task.responses['202'].headers?.Location,
    );
    assert.ok(
      approval?.responses['202'] !== undefined &&
        !('$ref' in approval.responses['202']) &&
        approval.responses['202'].headers?.Location === undefined,
    );
  });
});
