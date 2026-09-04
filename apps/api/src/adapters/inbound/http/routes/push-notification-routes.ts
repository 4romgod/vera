import type { FastifyInstance } from 'fastify';

import type { PushNotificationService } from '../../../../application/notifications/push-notification-service.ts';
import type {
  NotificationDeviceRegistration,
  PushPreferences,
} from '../../../../domain/notifications/push-notification.ts';
import {
  IdempotencyHeadersJsonSchema,
  NotificationDeviceJsonSchema,
  NotificationDeviceListJsonSchema,
  NotificationDeviceRegistrationJsonSchema,
  PushDeliveryJsonSchema,
  PushDeliveryListJsonSchema,
  PushNotificationStatusJsonSchema,
  PushPreferencesJsonSchema,
  ResourceIdParamsJsonSchema,
  type IdempotencyHeaders,
  type ResourceIdParams,
} from '../schemas.ts';

export function registerPushNotificationRoutes(
  app: FastifyInstance,
  options: { principalId: string; service: PushNotificationService },
) {
  app.get(
    '/v1/push-notifications/status',
    { schema: { response: { 200: PushNotificationStatusJsonSchema } } },
    () => options.service.status(),
  );
  app.get(
    '/v1/notification-devices',
    { schema: { response: { 200: NotificationDeviceListJsonSchema } } },
    () => options.service.listDevices(options.principalId),
  );
  app.post<{ Body: NotificationDeviceRegistration }>(
    '/v1/notification-devices',
    {
      schema: {
        body: NotificationDeviceRegistrationJsonSchema,
        response: { 200: NotificationDeviceJsonSchema },
      },
    },
    (request) => options.service.register(options.principalId, request.body),
  );
  app.put<{ Params: ResourceIdParams; Body: PushPreferences }>(
    '/v1/notification-devices/:id/preferences',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        body: PushPreferencesJsonSchema,
        response: { 200: NotificationDeviceJsonSchema },
      },
    },
    (request) =>
      options.service.updatePreferences(
        options.principalId,
        request.params.id,
        request.body,
      ),
  );
  app.post<{ Params: ResourceIdParams }>(
    '/v1/notification-devices/:id/revoke',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        response: { 200: NotificationDeviceJsonSchema },
      },
    },
    (request) => options.service.revoke(options.principalId, request.params.id),
  );
  app.post<{ Params: ResourceIdParams; Headers: IdempotencyHeaders }>(
    '/v1/notification-devices/:id/test',
    {
      schema: {
        params: ResourceIdParamsJsonSchema,
        headers: IdempotencyHeadersJsonSchema,
        response: { 200: PushDeliveryJsonSchema },
      },
    },
    (request) =>
      options.service.test(
        options.principalId,
        request.params.id,
        request.headers['idempotency-key'],
      ),
  );
  app.get(
    '/v1/push-deliveries',
    { schema: { response: { 200: PushDeliveryListJsonSchema } } },
    () => options.service.listDeliveries(options.principalId, 100),
  );
}
