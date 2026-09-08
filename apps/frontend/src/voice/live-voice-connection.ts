import type { Room } from 'livekit-client';

import {
  parseLiveVoiceEvent,
  type LiveVoiceEvent,
} from './live-voice-events.ts';
import {
  startLiveKitAudioSession,
  stopLiveKitAudioSession,
} from '@/voice/livekit-runtime';
import { loadLiveKitClient } from './livekit-client-loader.ts';

export type LiveVoiceConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export class LiveVoiceConnection {
  private room: Room | undefined;
  private stopped = false;

  public constructor(
    private readonly callbacks: {
      event(event: LiveVoiceEvent): void;
      state(state: LiveVoiceConnectionState): void;
    },
  ) {
    // LiveKit is loaded lazily in connect so React Native WebRTC globals are
    // registered before livekit-client evaluates its runtime capabilities.
  }

  public async connect(url: string, token: string) {
    this.callbacks.state('connecting');
    try {
      const { Room: LiveKitRoom, RoomEvent } = await loadLiveKitClient();
      if (this.stopped) return;
      const room = new LiveKitRoom({
        adaptiveStream: false,
        dynacast: false,
      });
      this.room = room;
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== 'vera.voice.events.v1') return;
        const event = parseLiveVoiceEvent(payload);
        if (event !== null) this.callbacks.event(event);
      });
      room.on(RoomEvent.Reconnecting, () =>
        this.callbacks.state('reconnecting'),
      );
      room.on(RoomEvent.Reconnected, () => this.callbacks.state('connected'));
      room.on(RoomEvent.Disconnected, () => {
        if (!this.stopped) this.callbacks.state('disconnected');
      });
      await startLiveKitAudioSession();
      if (this.isStopped()) {
        await stopLiveKitAudioSession().catch(() => undefined);
        return;
      }
      await room.connect(url, token, { autoSubscribe: false });
      if (this.isStopped()) {
        await room.disconnect();
        await stopLiveKitAudioSession().catch(() => undefined);
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true, {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      });
      this.callbacks.state('connected');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop() {
    if (this.stopped) return;
    this.stopped = true;
    const room = this.room;
    this.room = undefined;
    await room?.localParticipant
      .setMicrophoneEnabled(false)
      .catch(() => undefined);
    await room?.disconnect();
    await stopLiveKitAudioSession().catch(() => undefined);
  }

  private isStopped() {
    return this.stopped;
  }
}
