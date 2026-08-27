import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createTranscriptionService } from '../../../../src/application/transcriptions/transcription-service.ts';
import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import type { SpeechTranscriptionProvider } from '../../../../src/ports/transcription/speech-transcription-provider.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';

const apps: ReturnType<typeof buildApp>[] = [];

function responseErrorCode(response: { json(): unknown }): unknown {
  return (response.json() as { error: { code: unknown } }).error.code;
}

function appFor(options: {
  maxAudioBytes?: number;
  transcribe?: SpeechTranscriptionProvider['transcribe'];
}) {
  const model = new FakeModelProvider({});
  const provider: SpeechTranscriptionProvider = {
    name: 'test_transcription',
    model: 'test-v1',
    dataBoundary: 'owner_controlled',
    transcribe:
      options.transcribe ??
      ((input) =>
        Promise.resolve({
          text: `bytes:${String(input.audio.byteLength)}`,
          provider: 'test_transcription',
          model: 'test-v1',
          durationMs: 2,
        })),
  };
  const app = buildApp({
    evaluateModelDecision: createEvaluateModelDecision(model),
    provider: model,
    transcriptions: createTranscriptionService({
      provider,
      maxAudioBytes: options.maxAudioBytes ?? 100,
    }),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('speech transcription HTTP API', () => {
  void it('transcribes supported raw audio without creating a durable resource', async () => {
    let receivedContentType = '';
    let receivedFilename = '';
    const app = appFor({
      transcribe: (input) => {
        receivedContentType = input.contentType;
        receivedFilename = input.filename;
        return Promise.resolve({
          text: '  Hello from voice.  ',
          provider: 'test_transcription',
          model: 'test-v1',
          durationMs: 3,
        });
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from([1, 2, 3]),
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      schemaVersion: 1,
      text: 'Hello from voice.',
      provider: 'test_transcription',
      model: 'test-v1',
      durationMs: 3,
    });
    assert.equal(receivedContentType, 'audio/webm');
    assert.equal(receivedFilename, 'recording.webm');
  });

  void it('rejects empty, oversized, and unsupported uploads before inference', async () => {
    const app = appFor({ maxAudioBytes: 4 });
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: { 'content-type': 'audio/wav' },
      payload: Buffer.alloc(0),
    });
    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: { 'content-type': 'audio/wav' },
      payload: Buffer.alloc(5),
    });
    const unsupported = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: { 'content-type': 'audio/ogg' },
      payload: Buffer.from([1]),
    });

    assert.equal(empty.statusCode, 422, empty.body);
    assert.equal(responseErrorCode(empty), 'audio_empty');
    assert.equal(oversized.statusCode, 413, oversized.body);
    assert.equal(responseErrorCode(oversized), 'audio_too_large');
    assert.equal(unsupported.statusCode, 415, unsupported.body);
    assert.equal(responseErrorCode(unsupported), 'audio_type_unsupported');
  });
});
