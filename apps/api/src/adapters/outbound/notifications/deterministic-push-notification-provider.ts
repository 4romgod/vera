import type {
  PushMessage,
  PushNotificationProvider,
} from '../../../ports/notifications/push-notification-provider.ts';

export class DeterministicPushNotificationProvider
  implements PushNotificationProvider
{
  readonly name = 'deterministic';
  private sequence = 0;
  readonly messages: PushMessage[] = [];
  send(message: PushMessage) {
    this.messages.push(structuredClone(message));
    this.sequence += 1;
    return Promise.resolve({
      status: 'accepted' as const,
      ticketId: `deterministic_ticket_${String(this.sequence)}`,
    });
  }
  receipt(_ticketId: string) {
    void _ticketId;
    return Promise.resolve({ status: 'delivered' as const });
  }
  checkReadiness() {
    return Promise.resolve();
  }
}
