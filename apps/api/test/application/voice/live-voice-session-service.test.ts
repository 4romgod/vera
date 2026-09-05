import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryLiveVoiceSessionStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-live-voice-session-store.ts';
import { InMemoryOwnerResourceStore } from '../../../src/adapters/outbound/persistence/memory/in-memory-owner-resource-store.ts';
import { createConversationService } from '../../../src/application/conversations/conversation-service.ts';
import {
  LiveVoiceSessionError,
  createLiveVoiceSessionService,
} from '../../../src/application/voice/live-voice-session-service.ts';
import { TaskAggregateSchema } from '../../../src/domain/tasks/task-aggregate.ts';
import type { TaskLifecycle } from '../../../src/application/tasks/task-lifecycle.ts';
import type {
  LiveVoiceClientEvent,
  LiveVoiceTransport,
  LiveVoiceTransportEvent,
} from '../../../src/ports/voice/live-voice-transport.ts';
import type { TranscriptionService } from '../../../src/application/transcriptions/transcription-service.ts';

const now = '2026-09-05T23:00:00.000Z';

class FakeLiveVoiceTransport implements LiveVoiceTransport {
  public events: LiveVoiceClientEvent[] = [];
  public closed = 0;
  public eventDuringOpen?: LiveVoiceTransportEvent;
  private listener?: (event: LiveVoiceTransportEvent) => void;

  public open(input: Parameters<LiveVoiceTransport['open']>[0]) {
    this.listener = (event) => input.onEvent(event);
    if (this.eventDuringOpen !== undefined) input.onEvent(this.eventDuringOpen);
    return Promise.resolve({
      credential: {
        url: 'ws://127.0.0.1:7880',
        token: 'owner-token',
        expiresAt: input.session.expiresAt,
      },
      publish: (event: LiveVoiceClientEvent) => {
        this.events.push(event);
        return Promise.resolve();
      },
      close: () => {
        this.closed += 1;
        return Promise.resolve();
      },
    });
  }

  public emit(event: LiveVoiceTransportEvent) {
    assert.ok(this.listener, 'transport must be open before emitting');
    this.listener(event);
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    return Promise.resolve();
  }
}

function terminalTask(taskId = 'task_voice_test') {
  return TaskAggregateSchema.parse({
    schemaVersion: 1,
    version: 1,
    task: {
      id: taskId,
      requestKey: 'message_voice_test',
      principalId: 'owner_v1',
      conversationId: 'conversation_voice_test',
      messageId: 'message_voice_test',
      message: 'What is Vera?',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: 'run_voice_test',
      status: 'succeeded',
      createdAt: now,
      updatedAt: now,
      conversationReply: {
        status: 'projected',
        messageId: 'message_reply_voice_test',
        requestKey: 'vera-reply:task_voice_test',
        content: 'Vera coordinates your digital work.',
        createdAt: now,
        projectedAt: now,
      },
    },
    events: [],
  });
}

function taskLifecycle(): TaskLifecycle {
  const aggregate = terminalTask();
  const unexpected = (): never => {
    throw new Error('Unexpected task lifecycle call.');
  };
  return {
    submit: () => Promise.resolve(aggregate),
    getTask: () => Promise.resolve(aggregate),
    getRun: () => Promise.resolve(aggregate),
    decideApproval: unexpected,
    cancelRun: unexpected,
    progressTask: unexpected,
    recoverInterrupted: () => Promise.resolve(),
  };
}

async function harness(
  options: { enabled?: boolean; reconnectGraceSeconds?: number } = {},
) {
  let id = 0;
  const warnings: unknown[] = [];
  const resources = new InMemoryOwnerResourceStore();
  const conversations = createConversationService({
    store: resources,
    clock: () => now,
    createId: (prefix) => `${prefix}_voice_test`,
  });
  await conversations.createConversation({
    principalId: 'owner_v1',
    creationKey: 'voice-conversation',
    title: 'Voice test',
  });
  const transport = new FakeLiveVoiceTransport();
  const transcriptions = {
    maxAudioBytes: 1_000_000,
    provider: {
      name: 'fake',
      model: 'fake-transcription',
      dataBoundary: 'owner_controlled',
      transcribe: () =>
        Promise.resolve({
          text: 'What is Vera?',
          provider: 'fake',
          model: 'fake-transcription',
          durationMs: 1,
        }),
    },
    transcribe: () =>
      Promise.resolve({
        text: 'What is Vera?',
        provider: 'fake',
        model: 'fake-transcription',
        durationMs: 1,
      }),
  } satisfies TranscriptionService;
  const store = new InMemoryLiveVoiceSessionStore();
  const service = createLiveVoiceSessionService({
    store,
    ...(options.enabled === false ? {} : { transport }),
    transcriptions,
    conversations,
    tasks: taskLifecycle(),
    sessionTtlSeconds: 1_800,
    reconnectGraceSeconds: options.reconnectGraceSeconds ?? 45,
    clock: () => now,
    createId: (prefix) => `${prefix}_${String(++id)}_voice_test`,
    warning: (error) => warnings.push(error),
  });
  return { service, store, transport, warnings };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

void describe('live voice session lifecycle', () => {
  void it('fails closed while the transport is disabled', async () => {
    const { service } = await harness({ enabled: false });
    assert.equal(service.enabled, false);
    await assert.rejects(
      service.create({
        principalId: 'owner_v1',
        requestKey: 'disabled-session',
        conversationId: 'conversation_voice_test',
        takeover: false,
      }),
      (error: unknown) =>
        error instanceof LiveVoiceSessionError &&
        error.code === 'live_voice_disabled',
    );
    await service.close();
  });

  void it('turns finalized speech into one durable task and tracks spoken delivery', async () => {
    const { service, transport, warnings } = await harness();
    const created = await service.create({
      principalId: 'owner_v1',
      requestKey: 'voice-session',
      conversationId: 'conversation_voice_test',
      takeover: false,
    });
    assert.equal(created.credential.token, 'owner-token');
    transport.emit({ type: 'owner_connected' });
    transport.emit({ type: 'speech_started' });
    transport.emit({
      type: 'utterance_finalized',
      audio: new Uint8Array([1, 2, 3]),
      contentType: 'audio/wav',
    });

    await waitFor(
      () => transport.events.some((event) => event.type === 'speech_delivery'),
      `voice response was not released: ${warnings.map(String).join('; ')}`,
    );
    const session = await service.get('owner_v1', created.session.id);
    assert.equal(session.status, 'active');
    assert.equal(session.turns.length, 1);
    const [turn] = session.turns;
    assert.ok(turn);
    assert.equal(turn.status, 'settled');
    assert.equal(turn.transcript, 'What is Vera?');
    assert.equal(session.deliveries.length, 1);
    const [delivery] = session.deliveries;
    assert.ok(delivery);
    assert.equal(delivery.state, 'released');
    assert.deepEqual(
      transport.events.map((event) => event.type),
      [
        'ready',
        'listening',
        'speech_started',
        'transcript',
        'turn_submitted',
        'listening',
        'speech_delivery',
      ],
    );

    const acknowledged = await service.acknowledgeDelivery({
      principalId: 'owner_v1',
      sessionId: created.session.id,
      deliveryId: delivery.id,
      outcome: 'played',
    });
    assert.equal(acknowledged.deliveries[0]?.state, 'played');
    const repeatedAcknowledgement = await service.acknowledgeDelivery({
      principalId: 'owner_v1',
      sessionId: created.session.id,
      deliveryId: delivery.id,
      outcome: 'played',
    });
    assert.deepEqual(repeatedAcknowledgement, acknowledged);
    const ended = await service.end('owner_v1', created.session.id);
    assert.equal(ended.status, 'ended');
    assert.equal(transport.closed, 1);
    await service.close();
  });

  void it('buffers transport events emitted before open returns', async () => {
    const { service, transport } = await harness();
    transport.eventDuringOpen = { type: 'owner_connected' };
    const created = await service.create({
      principalId: 'owner_v1',
      requestKey: 'opening-event-session',
      conversationId: 'conversation_voice_test',
      takeover: false,
    });

    await waitFor(
      () => transport.events.some((event) => event.type === 'ready'),
      'event emitted during transport open was not replayed',
    );
    assert.equal(
      (await service.get('owner_v1', created.session.id)).status,
      'active',
    );
    await service.close();
  });

  void it('keeps only one reconnect timeout across duplicate disconnect events', async () => {
    const { service, transport } = await harness({
      reconnectGraceSeconds: 0.02,
    });
    const created = await service.create({
      principalId: 'owner_v1',
      requestKey: 'duplicate-disconnect-session',
      conversationId: 'conversation_voice_test',
      takeover: false,
    });
    transport.emit({ type: 'owner_connected' });
    transport.emit({ type: 'owner_disconnected' });
    transport.emit({ type: 'owner_disconnected' });
    transport.emit({ type: 'owner_connected' });
    await waitFor(
      () =>
        transport.events.filter((event) => event.type === 'ready').length === 2,
      'reconnection did not settle',
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    assert.equal(
      (await service.get('owner_v1', created.session.id)).status,
      'active',
    );
    await service.close();
  });

  void it('marks released speech unknown rather than replaying it after recovery', async () => {
    const { service, store, transport, warnings } = await harness();
    const created = await service.create({
      principalId: 'owner_v1',
      requestKey: 'recovery-session',
      conversationId: 'conversation_voice_test',
      takeover: false,
    });
    transport.emit({ type: 'owner_connected' });
    transport.emit({
      type: 'utterance_finalized',
      audio: new Uint8Array([4, 5, 6]),
      contentType: 'audio/wav',
    });
    await waitFor(
      async () =>
        (await service.get('owner_v1', created.session.id)).deliveries
          .length === 1,
      `voice delivery was not persisted: ${warnings.map(String).join('; ')}`,
    );
    await service.close();

    const recovered = createLiveVoiceSessionService({
      store,
      transcriptions: {} as TranscriptionService,
      conversations: {} as never,
      tasks: {} as never,
      sessionTtlSeconds: 1_800,
      reconnectGraceSeconds: 45,
      clock: () => '2026-09-06T23:00:00.000Z',
    });
    assert.equal(await recovered.recoverInterrupted(), 1);
    const session = await recovered.get('owner_v1', created.session.id);
    assert.equal(session.status, 'failed');
    assert.equal(session.deliveries[0]?.state, 'delivery_unknown');
    await recovered.close();
  });

  void it('preserves request idempotency and one active session per owner', async () => {
    const { service } = await harness();
    const input = {
      principalId: 'owner_v1',
      requestKey: 'idempotent-session',
      conversationId: 'conversation_voice_test',
      takeover: false,
    };
    const first = await service.create(input);
    const repeated = await service.create(input);
    assert.equal(repeated.session.id, first.session.id);
    assert.equal(repeated.credential.token, first.credential.token);

    await assert.rejects(
      service.create({ ...input, requestKey: 'different-session' }),
      (error: unknown) =>
        error instanceof LiveVoiceSessionError &&
        error.code === 'voice_session_active',
    );
    await service.end('owner_v1', first.session.id);
    await service.close();
  });
});
