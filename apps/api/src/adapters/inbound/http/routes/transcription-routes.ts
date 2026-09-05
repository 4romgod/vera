import type { FastifyInstance } from 'fastify';

import type { TranscriptionService } from '../../../../application/transcriptions/transcription-service.ts';
import { SpeechTranscriptionResponseJsonSchema } from '../schemas.ts';

const AudioContentTypes = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
];

export function registerTranscriptionRoutes(
  app: FastifyInstance,
  transcriptions: TranscriptionService,
): void {
  for (const contentType of AudioContentTypes) {
    app.addContentTypeParser(
      contentType,
      { parseAs: 'buffer', bodyLimit: transcriptions.maxAudioBytes },
      (_request, body, done) => done(null, body),
    );
  }

  app.post<{ Body: Buffer }>(
    '/v1/audio/transcriptions',
    {
      bodyLimit: transcriptions.maxAudioBytes,
      schema: {
        response: { 200: SpeechTranscriptionResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      reply.raw.once('close', abort);
      try {
        const result = await transcriptions.transcribe({
          audio: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
          contentType: request.headers['content-type'] ?? '',
          signal: controller.signal,
        });
        return {
          schemaVersion: 1 as const,
          ...result,
        };
      } finally {
        request.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', abort);
      }
    },
  );
}
