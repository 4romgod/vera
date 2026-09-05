import { Room, RoomEvent } from 'livekit-client';

import {
  parseLiveVoiceEvent,
  type LiveVoiceEvent,
} from './live-voice-events.ts';
import {
  initializeLiveKit,
  startLiveKitAudioSession,
  stopLiveKitAudioSession,
} from './livekit-runtime.ts';

export type LiveVoiceConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export class LiveVoiceConnection {
  private readonly room: Room;
  private stopped = false;

  public constructor(
    private readonly callbacks: {
      event(event: LiveVoiceEvent): void;
      state(state: LiveVoiceConnectionState): void;
    },
  ) {
    initializeLiveKit();
    this.room = new Room({
      adaptiveStream: false,
      dynacast: false,
    });
    this.room.on(
      RoomEvent.DataReceived,
      (payload, _participant, _kind, topic) => {
        if (topic !== 'vera.voice.events.v1') return;
        const event = parseLiveVoiceEvent(payload);
        if (event !== null) callbacks.event(event);
      },
    );
    this.room.on(RoomEvent.Reconnecting, () => callbacks.state('reconnecting'));
    this.room.on(RoomEvent.Reconnected, () => callbacks.state('connected'));
    this.room.on(RoomEvent.Disconnected, () => {
      if (!this.stopped) callbacks.state('disconnected');
    });
  }

  public async connect(url: string, token: string) {
    this.callbacks.state('connecting');
    await startLiveKitAudioSession();
    try {
      await this.room.connect(url, token, { autoSubscribe: false });
      if (this.stopped) {
        await this.room.disconnect();
        await stopLiveKitAudioSession().catch(() => undefined);
        return;
      }
      await this.room.localParticipant.setMicrophoneEnabled(true, {
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
    await this.room.localParticipant
      .setMicrophoneEnabled(false)
      .catch(() => undefined);
    await this.room.disconnect();
    await stopLiveKitAudioSession().catch(() => undefined);
  }
}
