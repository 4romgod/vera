import type { LiveVoiceSession } from '../../domain/voice/live-voice-session.ts';

export type LiveVoiceTransportEvent =
  | { type: 'owner_connected' }
  | { type: 'owner_disconnected' }
  | { type: 'speech_started' }
  | { type: 'transport_failed'; error: Error }
  | {
      type: 'utterance_finalized';
      audio: Uint8Array;
      contentType: 'audio/wav';
    };

export type LiveVoiceClientEvent =
  | { schemaVersion: 1; type: 'ready'; sessionId: string }
  | { schemaVersion: 1; type: 'listening'; sessionId: string }
  | { schemaVersion: 1; type: 'speech_started'; sessionId: string }
  | {
      schemaVersion: 1;
      type: 'transcript';
      sessionId: string;
      turnId: string;
      text: string;
    }
  | {
      schemaVersion: 1;
      type: 'turn_submitted';
      sessionId: string;
      turnId: string;
      taskId: string;
      runId: string;
    }
  | {
      schemaVersion: 1;
      type: 'speech_delivery';
      sessionId: string;
      turnId: string;
      deliveryId: string;
      kind: 'approval' | 'response' | 'failure';
      text: string;
    }
  | {
      schemaVersion: 1;
      type: 'error';
      sessionId: string;
      turnId?: string;
      message: string;
    }
  | { schemaVersion: 1; type: 'ended'; sessionId: string; reason: string };

export type LiveVoiceTransportCredential = {
  url: string;
  token: string;
  expiresAt: string;
};

export type LiveVoiceTransportHandle = {
  credential: LiveVoiceTransportCredential;
  publish(event: LiveVoiceClientEvent): Promise<void>;
  close(): Promise<void>;
};

export type LiveVoiceTransport = {
  open(input: {
    session: LiveVoiceSession;
    onEvent(event: LiveVoiceTransportEvent): void;
  }): Promise<LiveVoiceTransportHandle>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
