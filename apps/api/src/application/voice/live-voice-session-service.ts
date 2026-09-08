import { randomUUID } from 'node:crypto';

import {
  LiveVoiceSessionSchema,
  type LiveVoiceSession,
} from '../../domain/voice/live-voice-session.ts';
import type { ConversationService } from '../conversations/conversation-service.ts';
import type { TaskLifecycle } from '../tasks/task-lifecycle.ts';
import type { TranscriptionService } from '../transcriptions/transcription-service.ts';
import type { LiveVoiceSessionStore } from '../../ports/persistence/live-voice-session-store.ts';
import { LiveVoiceSessionConflictError } from '../../ports/persistence/live-voice-session-store.ts';
import type {
  LiveVoiceTransport,
  LiveVoiceTransportCredential,
  LiveVoiceTransportEvent,
  LiveVoiceTransportHandle,
} from '../../ports/voice/live-voice-transport.ts';
import { LiveVoiceSessionError } from './live-voice-session-error.ts';
import { LiveVoiceSessionState } from './live-voice-session-state.ts';
import { createLiveVoiceTurnRunner } from './live-voice-turn-runner.ts';

export { LiveVoiceSessionError } from './live-voice-session-error.ts';

export type LiveVoiceSessionService = {
  readonly enabled: boolean;
  create(input: {
    principalId: string;
    requestKey: string;
    conversationId: string;
    projectId?: string;
    takeover: boolean;
  }): Promise<{
    session: LiveVoiceSession;
    credential: LiveVoiceTransportCredential;
  }>;
  get(principalId: string, sessionId: string): Promise<LiveVoiceSession>;
  end(principalId: string, sessionId: string): Promise<LiveVoiceSession>;
  acknowledgeDelivery(input: {
    principalId: string;
    sessionId: string;
    deliveryId: string;
    outcome: 'played' | 'interrupted' | 'delivery_unknown';
  }): Promise<LiveVoiceSession>;
  recoverInterrupted(): Promise<number>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};

type ActiveSession = {
  handle: LiveVoiceTransportHandle;
  queue: Promise<void>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  expiryTimer: ReturnType<typeof setTimeout>;
};

export function createLiveVoiceSessionService(options: {
  store: LiveVoiceSessionStore;
  transport?: LiveVoiceTransport;
  transcriptions: TranscriptionService;
  conversations: ConversationService;
  tasks: TaskLifecycle;
  sessionTtlSeconds: number;
  reconnectGraceSeconds: number;
  clock?: () => string;
  createId?: (prefix: string) => string;
  warning?: (error: unknown, context: Record<string, unknown>) => void;
}): LiveVoiceSessionService {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const active = new Map<string, ActiveSession>();
  const state = new LiveVoiceSessionState(options.store, clock);
  let closed = false;
  let recoveryComplete = false;
  let recoveryBarrier: Promise<number> | undefined;

  async function publish(
    sessionId: string,
    event: Parameters<LiveVoiceTransportHandle['publish']>[0],
  ) {
    const running = active.get(sessionId);
    if (running === undefined) return;
    try {
      await running.handle.publish(event);
    } catch (error) {
      options.warning?.(error, {
        voiceSessionId: sessionId,
        event: event.type,
      });
    }
  }

  async function failSession(session: LiveVoiceSession, cause: unknown) {
    options.warning?.(cause, {
      voiceSessionId: session.id,
      phase: 'session_failure',
    });
    await state
      .updateStatus(session, 'failed', {
        failure: 'The live voice session stopped unexpectedly.',
        endedAt: clock(),
      })
      .catch((error: unknown) =>
        options.warning?.(error, { voiceSessionId: session.id, phase: 'fail' }),
      );
    await stopRuntime(session.id);
  }

  async function stopRuntime(sessionId: string) {
    const running = active.get(sessionId);
    if (running === undefined) return;
    active.delete(sessionId);
    clearTimeout(running.expiryTimer);
    if (running.reconnectTimer !== undefined)
      clearTimeout(running.reconnectTimer);
    await running.handle.close().catch((error: unknown) =>
      options.warning?.(error, {
        voiceSessionId: sessionId,
        phase: 'transport_close',
      }),
    );
  }

  async function handleTransportEvent(
    original: LiveVoiceSession,
    event: LiveVoiceTransportEvent,
  ) {
    const session = await state.require(original.principalId, original.id);
    if (!['starting', 'active', 'reconnecting'].includes(session.status))
      return;
    const running = active.get(session.id);
    if (running === undefined) return;
    if (event.type === 'transport_failed') {
      await publish(session.id, {
        schemaVersion: 1,
        type: 'error',
        sessionId: session.id,
        message: 'The live voice transport stopped unexpectedly.',
      });
      await failSession(session, event.error);
      return;
    }
    if (event.type === 'owner_connected') {
      if (running.reconnectTimer !== undefined) {
        clearTimeout(running.reconnectTimer);
        delete running.reconnectTimer;
      }
      await state.updateStatus(session, 'active', { connectedAt: clock() });
      await publish(session.id, {
        schemaVersion: 1,
        type: 'ready',
        sessionId: session.id,
      });
      await publish(session.id, {
        schemaVersion: 1,
        type: 'listening',
        sessionId: session.id,
      });
      return;
    }
    if (event.type === 'owner_disconnected') {
      await state.updateStatus(session, 'reconnecting');
      if (running.reconnectTimer !== undefined)
        clearTimeout(running.reconnectTimer);
      running.reconnectTimer = setTimeout(() => {
        void endSession(session.principalId, session.id, 'reconnect_timeout');
      }, options.reconnectGraceSeconds * 1_000);
      return;
    }
    if (event.type === 'speech_started') {
      await publish(session.id, {
        schemaVersion: 1,
        type: 'speech_started',
        sessionId: session.id,
      });
      return;
    }
    await turnRunner.processUtterance(
      session.principalId,
      session.id,
      event.audio,
    );
  }

  function enqueueTransportEvent(
    session: LiveVoiceSession,
    event: LiveVoiceTransportEvent,
  ) {
    const running = active.get(session.id);
    if (running === undefined) return;
    running.queue = running.queue
      .then(() => handleTransportEvent(session, event))
      .catch(async (error: unknown) => {
        options.warning?.(error, {
          voiceSessionId: session.id,
          phase: 'transport_event',
        });
        await failSession(session, error);
      });
  }
  async function endSession(
    principalId: string,
    sessionId: string,
    reason: string,
  ) {
    const session = await state.require(principalId, sessionId);
    if (session.status === 'ended' || session.status === 'failed')
      return session;
    await publish(sessionId, {
      schemaVersion: 1,
      type: 'ended',
      sessionId,
      reason,
    });
    const now = clock();
    const ended = await state.mutate(principalId, sessionId, (current) => {
      const { activeSlot: ignoredActiveSlot, ...inactive } = current;
      void ignoredActiveSlot;
      return {
        ...inactive,
        version: current.version + 1,
        status: 'ended',
        updatedAt: now,
        endedAt: now,
        deliveries: current.deliveries.map((delivery) =>
          delivery.state === 'released'
            ? { ...delivery, state: 'delivery_unknown', settledAt: now }
            : delivery,
        ),
      };
    });
    await stopRuntime(sessionId);
    return ended;
  }

  const turnRunner = createLiveVoiceTurnRunner({
    state,
    transcriptions: options.transcriptions,
    conversations: options.conversations,
    tasks: options.tasks,
    clock,
    createId,
    publish,
    endSession,
    isSessionActive: (sessionId) => active.has(sessionId),
    ...(options.warning === undefined ? {} : { warning: options.warning }),
  });

  async function performRecovery() {
    const now = clock();
    const recoverable = await options.store.findRecoverable();
    for (const session of recoverable) {
      await state.mutate(session.principalId, session.id, (current) => {
        const { activeSlot: ignoredActiveSlot, ...inactive } = current;
        void ignoredActiveSlot;
        return {
          ...inactive,
          version: current.version + 1,
          status: 'failed',
          failure:
            'The live transport process restarted. Finalized turns remain in the ordinary task ledger; start a new live session.',
          updatedAt: now,
          endedAt: now,
          deliveries: current.deliveries.map((delivery) =>
            delivery.state === 'released'
              ? { ...delivery, state: 'delivery_unknown', settledAt: now }
              : delivery,
          ),
        };
      });
    }
    return recoverable.length;
  }

  function ensureRecovery(): Promise<number> {
    if (recoveryComplete) return Promise.resolve(0);
    if (recoveryBarrier !== undefined) return recoveryBarrier;
    const attempt = performRecovery().then((count) => {
      recoveryComplete = true;
      return count;
    });
    recoveryBarrier = attempt;
    void attempt.then(
      () => {
        if (recoveryBarrier === attempt) recoveryBarrier = undefined;
      },
      () => {
        if (recoveryBarrier === attempt) recoveryBarrier = undefined;
      },
    );
    return attempt;
  }

  return {
    enabled: options.transport !== undefined,
    async create(input) {
      if (options.transport === undefined) {
        throw new LiveVoiceSessionError(
          'Live conversation mode is not configured on this Vera server.',
          'live_voice_disabled',
        );
      }
      if (closed) throw new Error('Live voice session service is closed.');
      await ensureRecovery();
      await options.conversations.getConversation(
        input.principalId,
        input.conversationId,
      );
      const existingByKey = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existingByKey !== null) {
        if (
          existingByKey.conversationId !== input.conversationId ||
          existingByKey.projectId !== input.projectId ||
          existingByKey.takeoverRequested !== input.takeover
        ) {
          throw new LiveVoiceSessionError(
            `Idempotency key ${input.requestKey} is already associated with different live voice session input.`,
            'idempotency_key_reused',
          );
        }
        const running = active.get(existingByKey.id);
        if (running === undefined) {
          throw new LiveVoiceSessionError(
            'The idempotent voice session is no longer recoverable; start a new session with a new key.',
            'voice_session_not_recoverable',
          );
        }
        return {
          session: existingByKey,
          credential: running.handle.credential,
        };
      }
      const existing = await options.store.findActive(input.principalId);
      if (existing !== null) {
        if (!input.takeover) {
          throw new LiveVoiceSessionError(
            `Voice session ${existing.id} is already active.`,
            'voice_session_active',
          );
        }
        await endSession(input.principalId, existing.id, 'taken_over');
      }
      const now = clock();
      const id = createId('voice_session');
      const session = LiveVoiceSessionSchema.parse({
        schemaVersion: 1,
        version: 1,
        id,
        principalId: input.principalId,
        requestKey: input.requestKey,
        takeoverRequested: input.takeover,
        activeSlot: 1,
        conversationId: input.conversationId,
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        roomName: `vera_voice_${id.slice('voice_session_'.length)}`,
        participantIdentity: `vera_owner_${id.slice('voice_session_'.length)}`,
        status: 'starting',
        expiresAt: new Date(
          Date.parse(now) + options.sessionTtlSeconds * 1_000,
        ).toISOString(),
        startedAt: now,
        updatedAt: now,
        turns: [],
        deliveries: [],
      });
      let created;
      try {
        created = await options.store.create(session);
      } catch (error) {
        if (error instanceof LiveVoiceSessionConflictError) {
          throw new LiveVoiceSessionError(
            'Another live voice session became active concurrently.',
            'voice_session_active',
          );
        }
        throw error;
      }
      if (!created.created) {
        throw new LiveVoiceSessionError(
          'The voice session request was already handled by another process.',
          'voice_session_not_recoverable',
        );
      }
      try {
        const pendingEvents: LiveVoiceTransportEvent[] = [];
        let runtimeRegistered = false;
        const handle = await options.transport.open({
          session,
          onEvent: (event) => {
            if (runtimeRegistered) enqueueTransportEvent(session, event);
            else pendingEvents.push(event);
          },
        });
        const expiryDelay = Math.max(
          1,
          Date.parse(session.expiresAt) - Date.parse(clock()),
        );
        active.set(session.id, {
          handle,
          queue: Promise.resolve(),
          expiryTimer: setTimeout(() => {
            void endSession(session.principalId, session.id, 'session_expired');
          }, expiryDelay),
        });
        runtimeRegistered = true;
        for (const event of pendingEvents)
          enqueueTransportEvent(session, event);
        return { session, credential: handle.credential };
      } catch (error) {
        await failSession(session, error);
        throw error;
      }
    },
    get: (principalId, sessionId) => state.require(principalId, sessionId),
    end: (principalId, sessionId) =>
      endSession(principalId, sessionId, 'owner_ended'),
    async acknowledgeDelivery(input) {
      return state.mutate(input.principalId, input.sessionId, (session) => {
        const delivery = session.deliveries.find(
          (candidate) => candidate.id === input.deliveryId,
        );
        if (delivery === undefined) {
          throw new LiveVoiceSessionError(
            `Speech delivery ${input.deliveryId} was not found.`,
            'voice_delivery_not_found',
          );
        }
        if (delivery.state !== 'released') {
          if (delivery.state === input.outcome) return session;
          throw new LiveVoiceSessionError(
            `Speech delivery ${input.deliveryId} is already ${delivery.state}.`,
            'voice_delivery_already_settled',
          );
        }
        const now = clock();
        return {
          ...session,
          version: session.version + 1,
          updatedAt: now,
          deliveries: session.deliveries.map((candidate) =>
            candidate.id === input.deliveryId
              ? { ...candidate, state: input.outcome, settledAt: now }
              : candidate,
          ),
        };
      });
    },
    recoverInterrupted() {
      return ensureRecovery();
    },
    async checkReadiness() {
      await ensureRecovery();
      await options.transport?.checkReadiness();
    },
    async close() {
      if (closed) return;
      closed = true;
      await recoveryBarrier?.catch((error: unknown) =>
        options.warning?.(error, { phase: 'recovery_during_close' }),
      );
      await Promise.all([...active.keys()].map((id) => stopRuntime(id)));
      await options.transport?.close();
    },
  };
}
