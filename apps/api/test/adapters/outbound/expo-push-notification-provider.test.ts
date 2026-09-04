import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpoPushNotificationProvider } from '../../../src/adapters/outbound/notifications/expo-push-notification-provider.ts';

void test('maps Expo tickets and DeviceNotRegistered receipts', async () => {
  const responses = [
    new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-one' } }), {
      status: 200,
    }),
    new Response(
      JSON.stringify({
        data: {
          'ticket-one': {
            status: 'error',
            details: { error: 'DeviceNotRegistered' },
          },
        },
      }),
      { status: 200 },
    ),
  ];
  const provider = new ExpoPushNotificationProvider({
    baseUrl: 'https://exp.host',
    timeoutMs: 1_000,
    fetch: () => {
      const response = responses.shift();
      if (response === undefined)
        throw new Error('Unexpected provider request.');
      return Promise.resolve(response);
    },
  });
  assert.deepEqual(
    await provider.send({
      token: 'ExpoPushToken[token]',
      title: 'Vera needs your attention',
      body: 'A result is ready for you.',
      data: { deepLink: 'vera://attention', deliveryId: 'push_delivery_one' },
    }),
    { status: 'accepted', ticketId: 'ticket-one' },
  );
  assert.deepEqual(await provider.receipt('ticket-one'), {
    status: 'rejected',
    code: 'DeviceNotRegistered',
    deviceInvalid: true,
  });
});
