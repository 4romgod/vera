export type PushMessage = {
  token: string;
  title: string;
  body: string;
  data: { deepLink: string; deliveryId: string };
};

export type PushSendResult =
  | { status: 'accepted'; ticketId: string }
  | { status: 'retryable'; code: string }
  | { status: 'rejected'; code: string; deviceInvalid: boolean };

export type PushReceiptResult =
  | { status: 'delivered' }
  | { status: 'pending' }
  | { status: 'retryable'; code: string }
  | { status: 'rejected'; code: string; deviceInvalid: boolean };

export type PushNotificationProvider = {
  readonly name: string;
  send(message: PushMessage): Promise<PushSendResult>;
  receipt(ticketId: string): Promise<PushReceiptResult>;
  checkReadiness(): Promise<void>;
};
