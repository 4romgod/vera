import type { FastifyInstance } from 'fastify';

import type { SpeechSynthesisService } from '../../../../application/speech/speech-synthesis-service.ts';
import {
  SpeechSynthesisAvailabilityResponseJsonSchema,
  SpeechSynthesisRequestJsonSchema,
  type SpeechSynthesisRequest,
} from '../schemas.ts';

export function registerSpeechSynthesisRoutes(
  app: FastifyInstance,
  speech: SpeechSynthesisService,
): void {
  app.get(
    '/v1/speech',
    {
      schema: {
        tags: ['speech'],
        response: { 200: SpeechSynthesisAvailabilityResponseJsonSchema },
      },
    },
    async () => {
      await speech.checkReadiness();
      return speech.availability();
    },
  );

  app.post<{ Body: SpeechSynthesisRequest }>(
    '/v1/speech',
    {
      schema: {
        tags: ['speech'],
        body: SpeechSynthesisRequestJsonSchema,
        response: {
          200: {
            type: 'string',
            format: 'binary',
            description: 'Synthesized mono WAV audio.',
          },
        },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      reply.raw.once('close', abort);
      try {
        const result = await speech.synthesize({
          text: request.body.text,
          ...(request.body.voice === undefined
            ? {}
            : { voice: request.body.voice }),
          signal: controller.signal,
        });
        return await reply
          .header('content-type', result.contentType)
          .header('content-length', result.audio.byteLength)
          .header('x-vera-speech-provider', result.provider)
          .header('x-vera-speech-model', result.model)
          .header('x-vera-speech-voice', result.voice)
          .send(Buffer.from(result.audio));
      } finally {
        request.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', abort);
      }
    },
  );
}
