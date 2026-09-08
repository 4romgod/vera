export type SpeechPlaybackStatus = {
  didJustFinish: boolean;
  error: string | null;
  isLoaded: boolean;
};

export type SpeechPlaybackPlayer = {
  addStatusListener(listener: (status: SpeechPlaybackStatus) => void): {
    remove(): void;
  };
  pause(): void;
  play(): void;
  release(): void;
  replace(uri: string): void;
};

export type SpeechPlaybackSource = {
  uri: string;
  release(): void;
};

export type SingleUseSpeechPlayback = {
  promise: Promise<void>;
  interrupt(): void;
};

export function startSingleUseSpeechPlayback(options: {
  source: SpeechPlaybackSource;
  createPlayer(): SpeechPlaybackPlayer;
}): SingleUseSpeechPlayback {
  const player = options.createPlayer();
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  let settled = false;
  let started = false;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const lifecycle: { subscription?: { remove(): void } } = {};
  const settle = (error?: Error) => {
    if (settled) return;
    settled = true;
    try {
      lifecycle.subscription?.remove();
    } catch {
      // Playback settlement must not depend on best-effort event cleanup.
    }
    try {
      player.release();
    } catch {
      // The owned player may already have been released by the native runtime.
    }
    try {
      options.source.release();
    } catch {
      // A stale cache file is preferable to leaving playback unsettled.
    }
    if (error === undefined) resolvePromise();
    else rejectPromise(error);
  };

  lifecycle.subscription = player.addStatusListener((status) => {
    if (status.error !== null) {
      settle(new Error(status.error));
      return;
    }
    if (status.didJustFinish) {
      settle();
      return;
    }
    if (status.isLoaded && !started) {
      started = true;
      try {
        player.play();
      } catch (error) {
        settle(
          error instanceof Error
            ? error
            : new Error('Speech playback could not start.'),
        );
      }
    }
  });

  try {
    player.replace(options.source.uri);
  } catch (error) {
    settle(
      error instanceof Error
        ? error
        : new Error('Speech audio could not be loaded.'),
    );
  }

  return {
    promise,
    interrupt() {
      if (settled) return;
      if (started) {
        try {
          player.pause();
        } catch {
          // Releasing the owned player below is the authoritative stop.
        }
      }
      settle(new Error('Speech playback was interrupted.'));
    },
  };
}
