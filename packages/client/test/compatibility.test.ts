import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertMemoryResource,
  assertTaskResource,
  isAttachmentReference,
  isPushPreferences,
} from '../src/index.ts';

void describe('client compatibility validation', () => {
  void it('keeps legacy validator names backed by strict generated schemas', () => {
    assert.throws(
      () =>
        assertTaskResource({
          schemaVersion: 1,
          taskId: 'task_test',
          runId: 'run_test',
          runStatus: 'succeeded',
          unexpected: true,
        }),
      /invalid task resource/u,
    );
    assert.throws(
      () => assertMemoryResource({ schemaVersion: 1, id: 'memory_test' }),
      /invalid memory resource/u,
    );
  });

  void it('keeps legacy guards strict without accepting Zod defaults', () => {
    assert.equal(
      isAttachmentReference({
        schemaVersion: 1,
        id: 'attachment_test',
        kind: 'image',
        filename: 'test.png',
        mediaType: 'image/png',
        byteLength: 1,
        sha256: 'a'.repeat(64),
      }),
      false,
    );
    assert.equal(isPushPreferences({ approvals: true }), false);
    assert.equal(
      isPushPreferences({
        approvals: true,
        reminders: true,
        tasks: true,
        failures: true,
        results: true,
      }),
      true,
    );
  });
});
