import type { FastifyInstance } from 'fastify';

import {
  AttachmentRequestError,
  type AttachmentService,
} from '../../../../application/attachments/attachment-service.ts';
import {
  AttachmentResponseJsonSchema,
  AttachmentUploadHeadersJsonSchema,
  ResourceIdParamsJsonSchema,
  type AttachmentUploadHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

const AttachmentTransportType = 'application/octet-stream';

export function registerAttachmentRoutes(
  app: FastifyInstance,
  options: { principalId: string; attachments: AttachmentService },
): void {
  app.addContentTypeParser(
    AttachmentTransportType,
    { parseAs: 'buffer', bodyLimit: options.attachments.maxAttachmentBytes },
    (_request, body, done) => done(null, body),
  );

  app.post<{ Body: Buffer; Headers: AttachmentUploadHeaders }>(
    '/v1/attachments',
    {
      bodyLimit: options.attachments.maxAttachmentBytes,
      schema: {
        headers: AttachmentUploadHeadersJsonSchema,
        response: {
          200: AttachmentResponseJsonSchema,
          201: AttachmentResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.headers['content-type'] !== AttachmentTransportType) {
        throw new AttachmentRequestError(
          'Attachments must use application/octet-stream transport with an x-vera-media-type header.',
          'attachment_type_unsupported',
        );
      }
      let filename: string;
      try {
        filename = decodeURIComponent(request.headers['x-vera-filename']);
      } catch {
        filename = request.headers['x-vera-filename'];
      }
      const result = await options.attachments.upload({
        principalId: options.principalId,
        filename,
        mediaType: request.headers['x-vera-media-type'],
        bytes: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
      });
      return reply
        .status(result.created ? 201 : 200)
        .header('location', `/v1/attachments/${result.attachment.id}`)
        .send(result.attachment);
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/attachments/:id',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: AttachmentResponseJsonSchema },
      },
    },
    (request) =>
      options.attachments.get(options.principalId, request.params.id),
  );

  app.get<{ Params: ResourceIdParams }>(
    '/v1/attachments/:id/preview',
    { schema: { params: ResourceIdParamsJsonSchema } },
    async (request, reply) => {
      const preview = await options.attachments.getImagePreview(
        options.principalId,
        request.params.id,
      );
      return reply
        .header('cache-control', 'private, max-age=31536000, immutable')
        .type(preview.mediaType)
        .send(Buffer.from(preview.bytes));
    },
  );
}
