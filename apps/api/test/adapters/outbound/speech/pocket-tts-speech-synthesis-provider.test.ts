import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PocketTtsSpeechSynthesisProvider } from '../../../../src/adapters/outbound/speech/pocket-tts-speech-synthesis-provider.ts';
import { SpeechSynthesisProviderError } from '../../../../src/ports/speech/speech-synthesis-provider.ts';

const wave = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);

function provider(fetch: typeof globalThis.fetch, maxAudioBytes = 100) {
  return new PocketTtsSpeechSynthesisProvider({
    baseUrl: 'http://127.0.0.1:8091',
    voice: 'alba',
    timeoutMs: 1_000,
    readinessTimeoutMs: 500,
    maxAudioBytes,
    fetch,
  });
}

void describe('Pocket TTS speech synthesis adapter', () => {
  void it('checks the configured voice and returns bounded WAV audio', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const subject = provider((input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.endsWith('/ready')) {
        return Promise.resolve(
          Response.json({
            status: 'ready',
            service: 'vera-pocket-tts',
            model: 'pocket-tts-3.1.0:english',
            voices: ['anna', 'alba'],
          }),
        );
      }
      return Promise.resolve(
        new Response(wave, {
          status: 200,
          headers: {
            'content-type': 'audio/wav',
            'content-length': String(wave.byteLength),
          },
        }),
      );
    });

    await subject.checkReadiness();
    const result = await subject.synthesize({
      text: 'Hello from Vera.',
      voice: 'anna',
    });

    assert.deepEqual(result.audio, wave);
    assert.equal(result.voice, 'anna');
    assert.deepEqual(subject.voices, ['alba', 'anna']);
    const speechRequest = requests[1];
    assert.ok(speechRequest);
    assert.equal(speechRequest.url, 'http://127.0.0.1:8091/v1/speech');
    assert.ok(speechRequest.init);
    const requestBody = speechRequest.init.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected the Pocket TTS request body to be JSON.');
    }
    assert.deepEqual(JSON.parse(requestBody), {
      schemaVersion: 1,
      text: 'Hello from Vera.',
      voiceId: 'anna',
    });
  });

  void it('rejects a voice that the sidecar did not advertise', async () => {
    const subject = provider(() => {
      return Promise.resolve(
        Response.json({
          status: 'ready',
          service: 'vera-pocket-tts',
          model: 'pocket-tts-3.1.0:english',
          voices: ['alba', 'anna'],
        }),
      );
    });
    await subject.checkReadiness();

    await assert.rejects(
      subject.synthesize({ text: 'Hello.', voice: 'unknown' }),
      (error: unknown) =>
        error instanceof SpeechSynthesisProviderError &&
        error.code === 'speech_rejected',
    );
  });

  void it('fails closed for a missing configured voice and invalid audio', async () => {
    const notReady = provider(() =>
      Promise.resolve(
        Response.json({
          status: 'ready',
          service: 'vera-pocket-tts',
          model: 'test',
          voices: ['anna'],
        }),
      ),
    );
    await assert.rejects(
      notReady.checkReadiness(),
      (error: unknown) =>
        error instanceof SpeechSynthesisProviderError &&
        error.code === 'speech_response_invalid',
    );

    const malformed = provider(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/wav', 'content-length': '3' },
        }),
      ),
    );
    await assert.rejects(
      malformed.synthesize({ text: 'Hello.' }),
      (error: unknown) =>
        error instanceof SpeechSynthesisProviderError &&
        error.code === 'speech_response_invalid',
    );
  });

  void it('rejects oversized and non-WAV provider responses', async () => {
    const oversized = provider(
      () =>
        Promise.resolve(
          new Response(wave, {
            headers: {
              'content-type': 'audio/wav',
              'content-length': String(wave.byteLength),
            },
          }),
        ),
      8,
    );
    await assert.rejects(
      oversized.synthesize({ text: 'Hello.' }),
      (error: unknown) =>
        error instanceof SpeechSynthesisProviderError &&
        error.code === 'speech_response_invalid',
    );

    const wrongType = provider(() =>
      Promise.resolve(
        new Response('{}', { headers: { 'content-type': 'application/json' } }),
      ),
    );
    await assert.rejects(
      wrongType.synthesize({ text: 'Hello.' }),
      (error: unknown) =>
        error instanceof SpeechSynthesisProviderError &&
        error.code === 'speech_response_invalid',
    );
  });
});
