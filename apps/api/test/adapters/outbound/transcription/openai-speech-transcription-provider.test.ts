import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OpenAiSpeechTranscriptionProvider } from '../../../../src/adapters/outbound/transcription/openai-speech-transcription-provider.ts';
import { SpeechTranscriptionProviderError } from '../../../../src/ports/transcription/speech-transcription-provider.ts';

function providerWith(fetchImplementation: typeof globalThis.fetch) {
  return new OpenAiSpeechTranscriptionProvider({
    baseUrl: 'https://openai.test/v1',
    apiKey: 'transcription-secret',
    model: 'gpt-transcribe',
    timeoutMs: 1_000,
    fetch: fetchImplementation,
  });
}

void describe('OpenAI speech transcription adapter', () => {
  void it('uploads a completed recording once and returns bounded metadata', async () => {
    let requestCount = 0;
    const provider = providerWith(async (input, init) => {
      requestCount += 1;
      assert.equal(input, 'https://openai.test/v1/audio/transcriptions');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer transcription-secret',
      );
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get('model'), 'gpt-transcribe');
      const file = init.body.get('file');
      assert.ok(file instanceof File);
      assert.equal(file.name, 'recording.webm');
      assert.equal(file.type, 'audio/webm');
      assert.deepEqual(
        [...new Uint8Array(await file.arrayBuffer())],
        [1, 2, 3],
      );
      return Response.json({ text: '  Hello Vera.  ' });
    });

    const result = await provider.transcribe({
      audio: Uint8Array.of(1, 2, 3),
      contentType: 'audio/webm',
      filename: 'recording.webm',
    });

    assert.equal(requestCount, 1);
    assert.equal(result.text, '  Hello Vera.  ');
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-transcribe');
    assert.ok(result.durationMs >= 0);
  });

  void it('sanitizes upstream rejection bodies', async () => {
    const provider = providerWith(() =>
      Promise.resolve(
        new Response('transcription-secret and private audio', { status: 401 }),
      ),
    );

    await assert.rejects(
      provider.transcribe({
        audio: Uint8Array.of(1),
        contentType: 'audio/mp4',
        filename: 'recording.m4a',
      }),
      (error: unknown) =>
        error instanceof SpeechTranscriptionProviderError &&
        error.code === 'transcription_rejected' &&
        !error.message.includes('transcription-secret') &&
        !error.message.includes('private audio'),
    );
  });

  void it('rejects malformed provider responses', async () => {
    const provider = providerWith(() =>
      Promise.resolve(Response.json({ transcript: 'wrong field' })),
    );

    await assert.rejects(
      provider.transcribe({
        audio: Uint8Array.of(1),
        contentType: 'audio/mp4',
        filename: 'recording.m4a',
      }),
      (error: unknown) =>
        error instanceof SpeechTranscriptionProviderError &&
        error.code === 'transcription_response_invalid',
    );
  });
});
