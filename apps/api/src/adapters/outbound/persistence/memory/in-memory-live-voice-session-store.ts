import type { LiveVoiceSession } from '../../../../domain/voice/live-voice-session.ts';
import type { LiveVoiceSessionStore } from '../../../../ports/persistence/live-voice-session-store.ts';
import { LiveVoiceSessionConflictError } from '../../../../ports/persistence/live-voice-session-store.ts';

export class InMemoryLiveVoiceSessionStore implements LiveVoiceSessionStore {
  private readonly sessions = new Map<string, LiveVoiceSession>();
  private readonly idsByRequest = new Map<string, string>();

  public create(session: LiveVoiceSession) {
    const key = this.requestIdentity(session.principalId, session.requestKey);
    const existingId = this.idsByRequest.get(key);
    if (existingId !== undefined) {
      const existing = this.sessions.get(existingId);
      if (existing === undefined)
        throw new Error('Voice session index is invalid.');
      return Promise.resolve({
        created: false,
        session: structuredClone(existing),
      });
    }
    if (
      session.activeSlot === 1 &&
      [...this.sessions.values()].some(
        (candidate) =>
          candidate.principalId === session.principalId &&
          candidate.activeSlot === 1,
      )
    ) {
      throw new LiveVoiceSessionConflictError();
    }
    this.idsByRequest.set(key, session.id);
    this.sessions.set(session.id, structuredClone(session));
    return Promise.resolve({
      created: true,
      session: structuredClone(session),
    });
  }

  public findById(principalId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return Promise.resolve(
      session?.principalId === principalId ? structuredClone(session) : null,
    );
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const id = this.idsByRequest.get(
      this.requestIdentity(principalId, requestKey),
    );
    return id === undefined
      ? Promise.resolve(null)
      : this.findById(principalId, id);
  }

  public findActive(principalId: string) {
    const session = [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.principalId === principalId &&
          ['starting', 'active', 'reconnecting'].includes(candidate.status),
      )
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    return Promise.resolve(
      session === undefined ? null : structuredClone(session),
    );
  }

  public replace(session: LiveVoiceSession, expectedVersion: number) {
    const existing = this.sessions.get(session.id);
    if (existing?.version !== expectedVersion) return Promise.resolve(false);
    this.sessions.set(session.id, structuredClone(session));
    return Promise.resolve(true);
  }

  public findRecoverable() {
    return Promise.resolve(
      [...this.sessions.values()]
        .filter((session) =>
          ['starting', 'active', 'reconnecting'].includes(session.status),
        )
        .map((session) => structuredClone(session)),
    );
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.sessions.clear();
    this.idsByRequest.clear();
    return Promise.resolve();
  }

  private requestIdentity(principalId: string, requestKey: string) {
    return `${principalId}\u0000${requestKey}`;
  }
}
