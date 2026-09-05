import type { LiveVoiceSession } from '../../domain/voice/live-voice-session.ts';

export class LiveVoiceSessionConflictError extends Error {
  public constructor() {
    super('A live voice session is already active for this principal.');
    this.name = 'LiveVoiceSessionConflictError';
  }
}

export type LiveVoiceSessionStore = {
  create(
    session: LiveVoiceSession,
  ): Promise<{ created: boolean; session: LiveVoiceSession }>;
  findById(
    principalId: string,
    sessionId: string,
  ): Promise<LiveVoiceSession | null>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<LiveVoiceSession | null>;
  findActive(principalId: string): Promise<LiveVoiceSession | null>;
  replace(session: LiveVoiceSession, expectedVersion: number): Promise<boolean>;
  findRecoverable(): Promise<LiveVoiceSession[]>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
