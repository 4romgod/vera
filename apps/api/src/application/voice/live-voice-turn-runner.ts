import { setTimeout as delay } from 'node:timers/promises';

import type { ConversationService } from '../conversations/conversation-service.ts';
import type { TaskLifecycle } from '../tasks/task-lifecycle.ts';
import type { TranscriptionService } from '../transcriptions/transcription-service.ts';
import type {
  LiveVoiceSession,
  SpeechDelivery,
  VoiceTurn,
} from '../../domain/voice/live-voice-session.ts';
import { LiveVoiceSessionLimits } from '../../domain/voice/live-voice-session.ts';
import type { LiveVoiceClientEvent } from '../../ports/voice/live-voice-transport.ts';
import type { LiveVoiceSessionState } from './live-voice-session-state.ts';

const TerminalRunStatuses = new Set([
  'succeeded',
  'rejected',
  'failed',
  'cancelled',
]);

export function createLiveVoiceTurnRunner(options: {
  state: LiveVoiceSessionState;
  transcriptions: TranscriptionService;
  conversations: ConversationService;
  tasks: TaskLifecycle;
  clock: () => string;
  createId(prefix: string): string;
  publish(sessionId: string, event: LiveVoiceClientEvent): Promise<void>;
  endSession(
    principalId: string,
    sessionId: string,
    reason: string,
  ): Promise<LiveVoiceSession>;
  isSessionActive(sessionId: string): boolean;
  warning?: (error: unknown, context: Record<string, unknown>) => void;
}) {
  async function releaseDelivery(
    session: LiveVoiceSession,
    turnId: string,
    kind: SpeechDelivery['kind'],
    content: string,
    messageId?: string,
  ) {
    const preparedAt = options.clock();
    const delivery: SpeechDelivery = {
      id: options.createId('speech_delivery'),
      turnId,
      kind,
      state: 'prepared',
      content,
      ...(messageId === undefined ? {} : { messageId }),
      preparedAt,
    };
    // Keeping preparation and release as separate durable transitions means a
    // restart can distinguish speech that was never exposed from speech that
    // may have reached the device and must not be replayed automatically.
    await options.state.mutate(session.principalId, session.id, (current) => ({
      ...current,
      version: current.version + 1,
      updatedAt: preparedAt,
      deliveries: [...current.deliveries, delivery],
    }));
    const releasedAt = options.clock();
    const updated = await options.state.mutate(
      session.principalId,
      session.id,
      (current) => ({
        ...current,
        version: current.version + 1,
        updatedAt: releasedAt,
        deliveries: current.deliveries.map((candidate) =>
          candidate.id === delivery.id
            ? { ...candidate, state: 'released', releasedAt }
            : candidate,
        ),
      }),
    );
    await options.publish(session.id, {
      schemaVersion: 1,
      type: 'speech_delivery',
      sessionId: session.id,
      turnId,
      deliveryId: delivery.id,
      kind,
      text: content,
    });
    return updated;
  }

  async function followTurn(
    session: LiveVoiceSession,
    turnId: string,
    taskId: string,
  ) {
    let approvalAnnounced = false;
    try {
      for (;;) {
        if (!options.isSessionActive(session.id)) return;
        const aggregate = await options.tasks.getTask(
          session.principalId,
          taskId,
        );
        if (
          aggregate.run.status === 'awaiting_approval' &&
          !approvalAnnounced
        ) {
          approvalAnnounced = true;
          await options.state.updateTurn(session, turnId, (turn) => ({
            ...turn,
            status: 'awaiting_approval',
            updatedAt: options.clock(),
          }));
          await releaseDelivery(
            session,
            turnId,
            'approval',
            'I need your approval before I can do that. Please review the approval card on screen.',
          );
        }
        const reply = aggregate.run.conversationReply;
        if (
          TerminalRunStatuses.has(aggregate.run.status) &&
          (reply === undefined || reply.status === 'projected')
        ) {
          await options.state.updateTurn(session, turnId, (turn) => ({
            ...turn,
            status: aggregate.run.status === 'succeeded' ? 'settled' : 'failed',
            ...(aggregate.run.failure === undefined
              ? {}
              : { failure: aggregate.run.failure.message.slice(0, 2_000) }),
            updatedAt: options.clock(),
          }));
          const content =
            reply?.content ??
            aggregate.run.failure?.message ??
            (aggregate.run.status === 'cancelled'
              ? 'That request was cancelled.'
              : 'That request is complete.');
          await releaseDelivery(
            session,
            turnId,
            aggregate.run.status === 'succeeded' ? 'response' : 'failure',
            content,
            reply?.messageId,
          );
          return;
        }
        await delay(500);
      }
    } catch (error) {
      options.warning?.(error, {
        voiceSessionId: session.id,
        voiceTurnId: turnId,
        phase: 'follow_turn',
      });
    }
  }

  return {
    async processUtterance(
      principalId: string,
      sessionId: string,
      audio: Uint8Array,
    ) {
      let session = await options.state.require(principalId, sessionId);
      if (!['active', 'reconnecting'].includes(session.status)) {
        options.warning?.(
          new Error('Discarded an utterance for an inactive voice session.'),
          {
            voiceSessionId: sessionId,
            voiceSessionStatus: session.status,
            phase: 'utterance_inactive',
          },
        );
        return;
      }
      if (session.turns.length >= LiveVoiceSessionLimits.maxTurns) {
        await options.publish(session.id, {
          schemaVersion: 1,
          type: 'error',
          sessionId,
          message: `This live conversation reached its ${String(LiveVoiceSessionLimits.maxTurns)}-turn safety limit.`,
        });
        await options.endSession(principalId, sessionId, 'turn_limit_reached');
        return;
      }
      const now = options.clock();
      const turn: VoiceTurn = {
        id: options.createId('voice_turn'),
        sequence: session.turns.length + 1,
        status: 'transcribing',
        createdAt: now,
        updatedAt: now,
      };
      session = await options.state.mutate(
        principalId,
        sessionId,
        (current) => ({
          ...current,
          version: current.version + 1,
          updatedAt: now,
          turns: [...current.turns, turn],
        }),
      );
      try {
        const transcription = await options.transcriptions.transcribe({
          audio,
          contentType: 'audio/wav',
        });
        const transcript = transcription.text;
        session = await options.state.updateTurn(
          session,
          turn.id,
          (current) => ({
            ...current,
            transcript,
            updatedAt: options.clock(),
          }),
        );
        await options.publish(sessionId, {
          schemaVersion: 1,
          type: 'transcript',
          sessionId,
          turnId: turn.id,
          text: transcript,
        });
        const appended = await options.conversations.appendOwnerMessage({
          principalId,
          conversationId: session.conversationId,
          requestKey: `live-voice:${turn.id}`,
          content: transcript,
          ...(session.projectId === undefined
            ? {}
            : { projectId: session.projectId }),
        });
        const aggregate =
          appended.taskId === undefined
            ? await options.tasks.submit({
                principalId,
                requestKey: appended.messageId,
                message: transcript,
                conversationId: session.conversationId,
                messageId: appended.messageId,
                ...(session.projectId === undefined
                  ? {}
                  : { projectId: session.projectId }),
              })
            : await options.tasks.getTask(principalId, appended.taskId);
        if (appended.taskId === undefined) {
          await options.conversations.attachTask({
            principalId,
            conversationId: session.conversationId,
            messageId: appended.messageId,
            taskId: aggregate.task.id,
          });
        }
        session = await options.state.updateTurn(
          session,
          turn.id,
          (current) => ({
            ...current,
            status: 'submitted',
            messageId: appended.messageId,
            taskId: aggregate.task.id,
            runId: aggregate.run.id,
            updatedAt: options.clock(),
          }),
        );
        await options.publish(sessionId, {
          schemaVersion: 1,
          type: 'turn_submitted',
          sessionId,
          turnId: turn.id,
          taskId: aggregate.task.id,
          runId: aggregate.run.id,
        });
        void followTurn(session, turn.id, aggregate.task.id);
      } catch (error) {
        options.warning?.(error, {
          voiceSessionId: session.id,
          voiceTurnId: turn.id,
          phase: 'process_utterance',
        });
        session = await options.state.updateTurn(
          session,
          turn.id,
          (current) => ({
            ...current,
            status: 'failed',
            failure: 'Vera could not process this spoken turn.',
            updatedAt: options.clock(),
          }),
        );
        await releaseDelivery(
          session,
          turn.id,
          'failure',
          'I could not understand that turn. Please try again.',
        );
        await options.publish(sessionId, {
          schemaVersion: 1,
          type: 'error',
          sessionId,
          turnId: turn.id,
          message: 'Vera could not process that spoken turn.',
        });
      } finally {
        await options.publish(sessionId, {
          schemaVersion: 1,
          type: 'listening',
          sessionId,
        });
      }
    },
  };
}
