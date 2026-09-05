import { isDeepStrictEqual } from 'node:util';

import {
  LiveVoiceSessionSchema,
  type LiveVoiceSession,
  type VoiceTurn,
} from '../../domain/voice/live-voice-session.ts';
import type { LiveVoiceSessionStore } from '../../ports/persistence/live-voice-session-store.ts';
import { LiveVoiceSessionError } from './live-voice-session-error.ts';

export const ActiveLiveVoiceStatuses = new Set<LiveVoiceSession['status']>([
  'starting',
  'active',
  'reconnecting',
]);

export class LiveVoiceSessionState {
  public constructor(
    private readonly store: LiveVoiceSessionStore,
    private readonly clock: () => string,
  ) {}

  public async require(principalId: string, sessionId: string) {
    const session = await this.store.findById(principalId, sessionId);
    if (session === null) {
      throw new LiveVoiceSessionError(
        `Voice session ${sessionId} was not found.`,
        'voice_session_not_found',
      );
    }
    return session;
  }

  public async mutate(
    principalId: string,
    sessionId: string,
    update: (session: LiveVoiceSession) => LiveVoiceSession,
  ) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.require(principalId, sessionId);
      const next = LiveVoiceSessionSchema.parse(
        update(structuredClone(current)),
      );
      if (isDeepStrictEqual(next, current)) return current;
      if (await this.store.replace(next, current.version)) return next;
    }
    throw new LiveVoiceSessionError(
      `Voice session ${sessionId} changed concurrently.`,
      'concurrent_transition_failed',
    );
  }

  public updateStatus(
    session: LiveVoiceSession,
    status: LiveVoiceSession['status'],
    extra: Partial<LiveVoiceSession> = {},
  ) {
    return this.mutate(session.principalId, session.id, (current) => {
      const next = {
        ...current,
        ...extra,
        status,
        version: current.version + 1,
        updatedAt: this.clock(),
      };
      if (ActiveLiveVoiceStatuses.has(status)) {
        return { ...next, activeSlot: 1 as const };
      }
      delete next.activeSlot;
      return next;
    });
  }

  public updateTurn(
    session: LiveVoiceSession,
    turnId: string,
    update: (turn: VoiceTurn) => VoiceTurn,
  ) {
    return this.mutate(session.principalId, session.id, (current) => ({
      ...current,
      version: current.version + 1,
      updatedAt: this.clock(),
      turns: current.turns.map((turn) =>
        turn.id === turnId ? update(turn) : turn,
      ),
    }));
  }
}
