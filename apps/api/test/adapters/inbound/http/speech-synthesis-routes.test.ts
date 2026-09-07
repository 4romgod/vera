import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { buildApp } from '../../../../src/adapters/inbound/http/build-app.ts';
import { createSpeechSynthesisService } from '../../../../src/application/speech/speech-synthesis-service.ts';
import type { SpeechSynthesisProvider } from '../../../../src/ports/speech/speech-synthesis-provider.ts';
import { SpeechSynthesisProviderError } from '../../../../src/ports/speech/speech-synthesis-provider.ts';
import { createEvaluateModelDecision } from '../../../../src/application/model-decisions/evaluate-model-decision.ts';
import { FakeModelProvider } from '../../../support/fake-model-provider.ts';

const apps: ReturnType<typeof buildApp>[] = [];
const wave = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);

function appFor(synthesize?: SpeechSynthesisProvider['synthesize']) {
  const model = new FakeModelProvider({});
  const speech = createSpeechSynthesisService({
    provider: {
      name: 'test_speech',
      model: 'speech-test-v1',
      voice: 'vera-test',
      voices: ['vera-test', 'vera-alt'],
      dataBoundary: 'owner_controlled',
      enabled: true,
      checkReadiness: () => Promise.resolve(),
      synthesize:
        synthesize ??
        (() =>
          Promise.resolve({
            audio: wave,
            contentType: 'audio/wav',
            provider: 'test_speech',
            model: 'speech-test-v1',
            voice: 'vera-test',
            durationMs: 1,
          })),
    },
  });
  const app = buildApp({
    evaluateModelDecision: createEvaluateModelDecision(model),
    provider: model,
    speech,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

void describe('speech synthesis HTTP API', () => {
  void it('discovers and synthesizes through the selected provider', async () => {
    let received = '';
    const app = appFor((input) => {
      received = `${input.voice ?? ''}:${input.text}`;
      return Promise.resolve({
        audio: wave,
        contentType: 'audio/wav',
        provider: 'test_speech',
        model: 'speech-test-v1',
        voice: 'vera-test',
        durationMs: 2,
      });
    });

    const availability = await app.inject({ method: 'GET', url: '/v1/speech' });
    assert.equal(availability.statusCode, 200);
    assert.deepEqual(availability.json(), {
      schemaVersion: 1,
      enabled: true,
      provider: 'test_speech',
      model: 'speech-test-v1',
      voice: 'vera-test',
      voices: ['vera-test', 'vera-alt'],
      dataBoundary: 'owner_controlled',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/speech',
      payload: { text: '  Hello from Vera.  ', voice: 'vera-alt' },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['content-type'], 'audio/wav');
    assert.equal(response.headers['x-vera-speech-provider'], 'test_speech');
    assert.equal(received, 'vera-alt:Hello from Vera.');
    assert.deepEqual(response.rawPayload, Buffer.from(wave));
  });

  void it('rejects unknown fields and sanitizes provider failures', async () => {
    const app = appFor(() =>
      Promise.reject(
        new SpeechSynthesisProviderError(
          'private upstream detail',
          'speech_unavailable',
        ),
      ),
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/speech',
      payload: { text: 'Hello.', unknown: 'untrusted' },
    });
    assert.equal(invalid.statusCode, 400);

    const unavailableVoice = await app.inject({
      method: 'POST',
      url: '/v1/speech',
      payload: { text: 'Hello.', voice: 'missing' },
    });
    assert.equal(unavailableVoice.statusCode, 422);

    const failed = await app.inject({
      method: 'POST',
      url: '/v1/speech',
      payload: { text: 'Hello.' },
    });
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), {
      error: {
        code: 'speech_unavailable',
        message: 'The speech provider is unavailable.',
      },
    });
    assert.doesNotMatch(failed.body, /private upstream detail/u);
  });
});
