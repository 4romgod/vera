import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import sharp from 'sharp';

import type { AppConfig } from '../../../../src/bootstrap/config.ts';
import { createApp } from '../../../../src/bootstrap/wiring.ts';

function config(): AppConfig {
  return {
    host: '127.0.0.1',
    port: 4310,
    model: { provider: 'deterministic', model: 'deterministic-v1' },
    conversationContext: { maxMessages: 20, maxCharacters: 40_000 },
    storage: {
      mode: 'memory',
      mongodbUri: 'mongodb://127.0.0.1:27017',
      mongodbDatabase: 'unused',
      redisUrl: 'redis://127.0.0.1:6379',
      scratchpadTtlSeconds: 60,
      dependencyTimeoutMs: 250,
    },
    planning: {
      adapterId: 'structured_model',
      adapters: { codexCli: { command: 'codex' } },
    },
    change: {
      adapterId: 'deterministic_change',
      adapters: { codexCli: { command: 'codex' } },
    },
    research: { adapterId: 'disabled' },
    transcription: { provider: 'disabled', maxAudioBytes: 25_000_000 },
    application: { workspacesRoot: '/tmp/vera-attachment-test-applications' },
    publication: {
      adapterId: 'github_gh_cli',
      gitCommand: 'git',
      ghCommand: 'gh',
    },
    worker: { concurrency: 2, pollIntervalMs: 5, leaseMs: 900_000 },
    reminders: {
      ownerTimeZone: 'Africa/Johannesburg',
      concurrency: 1,
      pollIntervalMs: 50,
      leaseMs: 1_000,
    },
  };
}

async function waitForRun(
  app: ReturnType<typeof createApp>,
  runId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      runStatus: string;
      approval?: {
        id: string;
        capability: { name: string };
        attachments?: { id: string; sha256: string }[];
        inputArtifacts?: { id: string; type: string; sha256: string }[];
        decisionEvidence?: { id: string; type: string; sha256: string }[];
        authority?: { dataClasses: string[]; sideEffects: string[] };
      };
      output?: {
        kind: string;
        analysis?: {
          summary: string;
          citations: {
            kind: 'document' | 'image';
            attachmentId: string;
            locator?: string;
          }[];
        };
        artifact?: { id: string };
        evidence?: { id: string; type: string; sha256: string }[];
        artifacts?: { id: string; type: string; sha256: string }[];
      };
      goal?: {
        steps: {
          capability: string;
          status: string;
          artifact?: { id: string; type: string; sha256: string };
        }[];
      };
      conversationReply?: { status: string };
    }>();
    if (
      body.runStatus === status &&
      (status !== 'succeeded' ||
        body.conversationReply === undefined ||
        body.conversationReply.status === 'projected')
    ) {
      return body;
    }
    if (
      ['succeeded', 'rejected', 'failed', 'cancelled'].includes(
        body.runStatus,
      ) &&
      body.runStatus !== status
    ) {
      throw new Error(
        `Run ${runId} reached ${body.runStatus} instead of ${status}: ${response.body}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach ${status}.`);
}

void describe('attachment intelligence HTTP journey', () => {
  let app: ReturnType<typeof createApp> | undefined;
  afterEach(async () => app?.close());

  void it('uploads, deduplicates, freezes, approves, analyzes, cites, and projects a document', async () => {
    app = createApp(config());
    const source = Buffer.from(
      [
        'Project Vera brief',
        'Vera is a personal AI orchestration system.',
        'It delegates work through governed capabilities.',
      ].join('\n'),
    );
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-media-type': 'text/plain',
        'x-vera-filename': encodeURIComponent('vera-brief.txt'),
      },
      payload: source,
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const attachment = upload.json<{
      id: string;
      filename: string;
      sha256: string;
      extraction: { totalCharacters: number };
    }>();
    assert.equal(attachment.filename, 'vera-brief.txt');
    assert.ok(attachment.extraction.totalCharacters > 0);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-media-type': 'text/plain',
        'x-vera-filename': encodeURIComponent('renamed.txt'),
      },
      payload: source,
    });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(duplicate.json<{ id: string }>().id, attachment.id);

    const createdConversation = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'attachment-conversation' },
      payload: { title: 'Document analysis' },
    });
    assert.equal(createdConversation.statusCode, 201, createdConversation.body);
    const conversationId = createdConversation.json<{ id: string }>().id;

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'attachment-message' },
      payload: {
        content: 'Analyze the attached document and summarize what Vera is.',
        attachmentIds: [attachment.id],
      },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;
    const awaiting = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(awaiting.approval);
    assert.equal(awaiting.approval.capability.name, 'attachment_analysis');
    assert.deepEqual(awaiting.approval.attachments, [
      {
        id: attachment.id,
        kind: 'document',
        filename: 'vera-brief.txt',
        mediaType: 'text/plain',
        byteLength: source.byteLength,
        sha256: attachment.sha256,
      },
    ]);
    assert.ok(
      awaiting.approval.authority?.dataClasses.includes('attachment_content'),
    );
    assert.deepEqual(awaiting.approval.authority?.sideEffects, []);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${awaiting.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);
    const completed = await waitForRun(app, runId, 'succeeded');
    assert.ok(completed.output);
    assert.equal(completed.output.kind, 'attachment_analysis');
    const citation = completed.output.analysis?.citations[0];
    assert.ok(citation);
    assert.equal(citation.attachmentId, attachment.id);
    assert.equal(citation.locator, 'lines 1-3');
    assert.ok(completed.output.artifact);

    const artifact = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${completed.output.artifact.id}`,
    });
    assert.equal(artifact.statusCode, 200, artifact.body);
    assert.equal(artifact.json<{ type: string }>().type, 'attachment_analysis');

    const conversation = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    assert.equal(conversation.statusCode, 200, conversation.body);
    const messages = conversation.json<{
      messages: { role: string; attachments?: { id: string }[] }[];
    }>().messages;
    assert.equal(messages[0]?.attachments?.[0]?.id, attachment.id);
    assert.equal(messages.at(-1)?.role, 'vera');

    const directTask = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'attachment-direct-task' },
      payload: {
        message: 'Analyze the attached document.',
        attachmentIds: [attachment.id],
      },
    });
    assert.equal(directTask.statusCode, 202, directTask.body);
    assert.equal(
      directTask.json<{ attachments?: { id: string }[] }>().attachments?.[0]
        ?.id,
      attachment.id,
    );
  });

  void it('rejects malformed attachment uploads before storage', async () => {
    app = createApp(config());
    const unsupportedTransport = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'text/plain',
        'x-vera-media-type': 'text/plain',
        'x-vera-filename': 'notes.txt',
      },
      payload: 'plain text sent without the binary transport envelope',
    });
    assert.equal(
      unsupportedTransport.statusCode,
      415,
      unsupportedTransport.body,
    );
    assert.equal(
      unsupportedTransport.json<{ error: { code: string } }>().error.code,
      'attachment_type_unsupported',
    );

    const malformedImage = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-media-type': 'image/png',
        'x-vera-filename': 'image.png',
      },
      payload: Buffer.from('not an image'),
    });
    assert.equal(malformedImage.statusCode, 422, malformedImage.body);

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-media-type': 'application/json',
        'x-vera-filename': 'bad.json',
      },
      payload: Buffer.from('{bad'),
    });
    assert.equal(malformed.statusCode, 422, malformed.body);
  });

  void it('understands an attachment and creates a separately approved task from its evidence', async () => {
    app = createApp(config());
    const source = Buffer.from(
      'Prepare the release checklist before Friday. Confirm the API and mobile smoke tests.',
    );
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-media-type': 'text/plain',
        'x-vera-filename': encodeURIComponent('release-note.txt'),
      },
      payload: source,
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const attachment = upload.json<{ id: string }>();

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { 'idempotency-key': 'attachment-derived-task' },
      payload: {
        message:
          'Analyze the attached note and create a task from its most important finding.',
        attachmentIds: [attachment.id],
      },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;

    const analysisApproval = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(analysisApproval.approval);
    assert.equal(
      analysisApproval.approval.capability.name,
      'attachment_analysis',
    );
    const analysisDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${analysisApproval.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(analysisDecision.statusCode, 202, analysisDecision.body);

    const taskApproval = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(taskApproval.approval);
    assert.equal(
      taskApproval.approval.capability.name,
      'personal_task_management',
    );
    assert.equal(taskApproval.approval.inputArtifacts, undefined);
    assert.equal(taskApproval.approval.decisionEvidence?.length, 1);
    const evidence = taskApproval.approval.decisionEvidence[0];
    assert.ok(evidence);
    assert.equal(evidence.type, 'attachment_analysis');
    assert.equal(
      taskApproval.goal?.steps[0]?.artifact?.sha256,
      evidence.sha256,
    );
    assert.ok(
      taskApproval.approval.authority?.dataClasses.includes('artifact_content'),
    );

    const taskDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${taskApproval.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(taskDecision.statusCode, 202, taskDecision.body);
    const completed = await waitForRun(app, runId, 'succeeded');
    assert.ok(completed.output);
    assert.ok(completed.goal);
    assert.equal(completed.output.kind, 'adaptive_goal_result');
    assert.deepEqual(
      completed.goal.steps.map(({ capability, status }) => ({
        capability,
        status,
      })),
      [
        { capability: 'attachment_analysis', status: 'succeeded' },
        { capability: 'personal_task_management', status: 'succeeded' },
      ],
    );
    assert.equal(completed.output.evidence?.[0]?.type, 'attachment_analysis');
    assert.deepEqual(
      completed.output.artifacts?.map(({ type }) => type),
      ['attachment_analysis', 'personal_task_result'],
    );

    const tasks = await app.inject({
      method: 'GET',
      url: '/v1/personal-tasks',
    });
    assert.equal(tasks.statusCode, 200, tasks.body);
    assert.match(
      tasks.json<{ tasks: { title: string }[] }>().tasks[0]?.title ?? '',
      /Prepare the release checklist/u,
    );
  });

  void it('uploads, previews, approves, analyzes, and cites an image', async () => {
    app = createApp(config());
    const source = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 3,
        background: { r: 236, g: 196, b: 73 },
      },
    })
      .png()
      .toBuffer();
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        'x-vera-media-type': 'image/png',
        'x-vera-filename': encodeURIComponent('yellow-board.png'),
      },
      payload: source,
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const attachment = upload.json<{
      id: string;
      kind: string;
      filename: string;
      vision: {
        status: string;
        processor: string;
        width: number;
        height: number;
        mediaType: string;
      };
    }>();
    assert.equal(attachment.kind, 'image');
    assert.equal(attachment.vision.status, 'ready');
    assert.equal(attachment.vision.processor, 'vera_image_vision_v1');
    assert.equal(attachment.vision.mediaType, 'image/jpeg');
    assert.equal(attachment.vision.width, 80);
    assert.equal(attachment.vision.height, 40);

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/attachments/${attachment.id}/preview`,
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.headers['content-type'], 'image/jpeg');
    const previewMetadata = await sharp(preview.rawPayload).metadata();
    assert.equal(previewMetadata.width, 80);
    assert.equal(previewMetadata.height, 40);

    const createdConversation = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'idempotency-key': 'image-conversation' },
      payload: { title: 'Image analysis' },
    });
    const conversationId = createdConversation.json<{ id: string }>().id;
    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { 'idempotency-key': 'image-message' },
      payload: {
        content: 'Describe the attached image.',
        attachmentIds: [attachment.id],
      },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;
    const awaiting = await waitForRun(app, runId, 'awaiting_approval');
    assert.ok(awaiting.approval);
    assert.equal(awaiting.approval.capability.name, 'attachment_analysis');
    assert.equal(awaiting.approval.attachments?.[0]?.id, attachment.id);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${awaiting.approval.id}/decision`,
      payload: { decision: 'approved' },
    });
    assert.equal(approved.statusCode, 202, approved.body);
    const completed = await waitForRun(app, runId, 'succeeded');
    assert.ok(completed.output);
    assert.equal(completed.output.kind, 'attachment_analysis');
    assert.ok(completed.output.analysis);
    assert.deepEqual(completed.output.analysis.citations, [
      {
        kind: 'image',
        attachmentId: attachment.id,
        filename: 'yellow-board.png',
      },
    ]);
  });
});
