import {
  AudioStream,
  Room,
  RoomEvent,
  TrackKind,
  dispose,
} from '@livekit/rtc-node';
import {
  VADEventType,
  initializeLogger,
  loggerOptions,
  type VAD,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

import type {
  LiveVoiceClientEvent,
  LiveVoiceTransport,
  LiveVoiceTransportHandle,
} from '../../../ports/voice/live-voice-transport.ts';
import { encodeWave } from './pcm-wave.ts';

const encoder = new TextEncoder();

export class LiveKitLiveVoiceTransport implements LiveVoiceTransport {
  private readonly roomService: RoomServiceClient;
  private readonly rooms = new Set<Room>();
  private vadPromise: Promise<VAD> | undefined;
  private closed = false;

  public constructor(
    private readonly options: {
      serverUrl: string;
      publicUrl: string;
      apiKey: string;
      apiSecret: string;
      endpointSilenceMs: number;
      maxUtteranceMs: number;
      readinessTimeoutMs: number;
    },
  ) {
    if (loggerOptions() === undefined)
      initializeLogger({ pretty: false, level: 'warn' });
    this.roomService = new RoomServiceClient(
      httpUrl(options.serverUrl),
      options.apiKey,
      options.apiSecret,
    );
  }

  public async open(input: Parameters<LiveVoiceTransport['open']>[0]) {
    if (this.closed) throw new Error('Live voice transport is closed.');
    await this.vad();
    const room = new Room();
    this.rooms.add(room);
    await this.roomService.createRoom({
      name: input.session.roomName,
      emptyTimeout: 60,
      departureTimeout: 60,
      maxParticipants: 2,
      metadata: JSON.stringify({
        schemaVersion: 1,
        voiceSessionId: input.session.id,
      }),
    });
    const workerIdentity = `vera_worker_${input.session.id}`;
    const workerToken = await this.token({
      identity: workerIdentity,
      roomName: input.session.roomName,
      canPublish: true,
      canSubscribe: true,
      expiresAt: input.session.expiresAt,
    });
    const ownerToken = await this.token({
      identity: input.session.participantIdentity,
      roomName: input.session.roomName,
      canPublish: true,
      canSubscribe: false,
      expiresAt: input.session.expiresAt,
    });

    const audioTasks = new Set<Promise<void>>();
    const audioControllers = new Set<AbortController>();
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.identity === input.session.participantIdentity) {
        input.onEvent({ type: 'owner_connected' });
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === input.session.participantIdentity) {
        input.onEvent({ type: 'owner_disconnected' });
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (
        participant.identity !== input.session.participantIdentity ||
        track.kind !== TrackKind.KIND_AUDIO
      )
        return;
      const audio = new AudioStream(track, {
        sampleRate: 16_000,
        numChannels: 1,
        frameSizeMs: 30,
      });
      const controller = new AbortController();
      audioControllers.add(controller);
      const task = this.consumeAudio(
        audio,
        (event) => input.onEvent(event),
        controller.signal,
      );
      audioTasks.add(task);
      void task
        .catch((error: unknown) =>
          input.onEvent({
            type: 'transport_failed',
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        )
        .finally(() => {
          audioControllers.delete(controller);
          audioTasks.delete(task);
        });
    });

    try {
      await room.connect(this.options.serverUrl, workerToken, {
        autoSubscribe: true,
        dynacast: false,
      });
    } catch (error) {
      this.rooms.delete(room);
      await room.disconnect().catch(() => undefined);
      await this.roomService
        .deleteRoom(input.session.roomName)
        .catch(() => undefined);
      throw error;
    }

    const handle: LiveVoiceTransportHandle = {
      credential: {
        url: this.options.publicUrl,
        token: ownerToken,
        expiresAt: input.session.expiresAt,
      },
      publish: (event) =>
        this.publish(room, input.session.participantIdentity, event),
      close: async () => {
        this.rooms.delete(room);
        for (const controller of audioControllers) controller.abort();
        await room.disconnect();
        await Promise.allSettled([...audioTasks]);
        await this.roomService
          .deleteRoom(input.session.roomName)
          .catch(() => undefined);
      },
    };
    return handle;
  }

  public async checkReadiness() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.roomService.listRooms([]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('LiveKit readiness check timed out.')),
            this.options.readinessTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  public async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(
      [...this.rooms].map((room) => room.disconnect().catch(() => undefined)),
    );
    this.rooms.clear();
    if (this.vadPromise !== undefined) await (await this.vadPromise).close();
    await dispose();
  }

  private readonly consumeAudio = async (
    audio: AudioStream,
    onEvent: Parameters<LiveVoiceTransport['open']>[0]['onEvent'],
    signal: AbortSignal,
  ) => {
    const vad = await this.vad();
    const stream = vad.stream();
    stream.updateInputStream(audio);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stream.detachInputStream();
      stream.close();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    try {
      for await (const event of stream) {
        if (event.type === VADEventType.START_OF_SPEECH) {
          onEvent({ type: 'speech_started' });
        } else if (
          event.type === VADEventType.END_OF_SPEECH &&
          event.frames.length > 0
        ) {
          onEvent({
            type: 'utterance_finalized',
            audio: encodeWave(event.frames),
            contentType: 'audio/wav',
          });
        }
      }
    } finally {
      signal.removeEventListener('abort', stop);
      stop();
    }
  };

  private vad() {
    return (this.vadPromise ??= silero.VAD.load({
      minSpeechDuration: 250,
      minSilenceDuration: this.options.endpointSilenceMs,
      prefixPaddingDuration: 400,
      maxBufferedSpeech: this.options.maxUtteranceMs,
      sampleRate: 16_000,
      forceCPU: true,
    }));
  }

  private async publish(
    room: Room,
    destination: string,
    event: LiveVoiceClientEvent,
  ) {
    const participant = room.localParticipant;
    if (participant === undefined)
      throw new Error('LiveKit worker is not connected.');
    await participant.publishData(encoder.encode(JSON.stringify(event)), {
      reliable: true,
      destination_identities: [destination],
      topic: 'vera.voice.events.v1',
    });
  }

  private async token(input: {
    identity: string;
    roomName: string;
    canPublish: boolean;
    canSubscribe: boolean;
    expiresAt: string;
  }) {
    const ttl = Math.max(
      1,
      Math.floor((Date.parse(input.expiresAt) - Date.now()) / 1_000),
    );
    const token = new AccessToken(this.options.apiKey, this.options.apiSecret, {
      identity: input.identity,
      ttl,
    });
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: input.canPublish,
      canPublishData: true,
      canSubscribe: input.canSubscribe,
    });
    return token.toJwt();
  }
}

function httpUrl(value: string) {
  return value.replace(/^wss:/u, 'https:').replace(/^ws:/u, 'http:');
}
