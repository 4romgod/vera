# ADR-0028: Treat device voice as a reviewed experience adapter

**Status:** Superseded by [ADR-0030](0030-transcribe-owner-controlled-recordings-through-a-provider-neutral-boundary.md)
**Date:** 26 August 2026

> This record preserves the original device-recognition decision. Physical
> testing exposed platform-controlled timeouts, duplicate result streams, and
> audible recognizer restarts. ADR-0030 replaces capture and transcription while
> retaining reviewed submission and durable reply playback.

## Context

Vera is intended to become a natural, Jarvis-like assistant, but adding a
microphone must not create a second command path that bypasses conversations,
approvals, cancellation, durable execution, or the API-first boundary. Speech
recognition also introduces a privacy boundary: depending on the device and its
settings, Apple, Google, or a browser vendor may process microphone audio.

The universal Expo frontend already owns the web, iOS, and Android experience.
The kernel already accepts text, creates durable runs, exposes exact approvals,
and projects terminal replies. Voice therefore does not require new domain
semantics or a server audio store.

## Decision

Implement voice as two replaceable device experience adapters inside
`apps/frontend`:

- speech recognition writes an editable transcript into the existing message
  composer;
- recognition is continuous while the owner keeps the session active, survives
  provider-imposed end events by resuming once per confirmed end, and stops
  defensively after two minutes without a recognized interim or final result;
- transient errors do not trigger teardown because mobile speech services can
  report them while the microphone session is still active; reconnecting is
  driven only by the definitive end event, preventing audible restart loops;
- while listening, `Stop` ends recognition and leaves the transcript editable,
  while `Stop and send` is a separate explicit owner action that ends
  recognition and submits the completed transcript through the ordinary path;
- Vera never submits merely because recognition produced a final result, timed
  out, or ended unexpectedly;
- the submitted text follows the same conversation, project-scope, run,
  approval, and cancellation paths as typed input;
- a reply to a voice-originated message is spoken with device text-to-speech
  only after its durable conversation projection exists;
- any Vera reply can be played or stopped explicitly;
- microphone audio is not uploaded to, logged by, or persisted in the Vera API;
  and
- starting recognition discloses in the interface that the configured device
  speech service handles audio.

The implementation uses `expo-speech-recognition` across web and native and
`expo-speech` for playback. Web uses the browser's speech service. Native speech
recognition requires a Vera development or production build because the module
is not bundled in Expo Go. Failure to load that module leaves typed interaction
available and produces an actionable message rather than crashing the app.

The speech locale is experience configuration, defaulting to `en-US` and
overridable with `EXPO_PUBLIC_VERA_SPEECH_LOCALE`. It does not influence model
selection or authority.

## Rationale

Keeping voice in the experience plane preserves one authoritative execution
path. A visible live transcript plus distinct review and deliberate atomic-send
actions protect against transcription errors, background speech, and accidental
commands. Waiting for durable reply projection before playback prevents the
spoken experience from claiming an answer that the conversation cannot recover
after restart.

Device recognition provides useful web and native behavior without coupling
the Vera server to one transcription vendor, uploading recordings to the Mac
Mini, or introducing another model-provider credential. The adapter can later
be replaced by an owner-controlled transcription service without changing
conversation or task contracts.

## Consequences

- Voice input has the same authority as typed input and never grants capability
  approval.
- The OS or browser speech provider is a separate disclosure boundary governed
  by explicit microphone permission and a deliberate start action.
- Recognition quality and availability vary by device, installed language, and
  browser. Typing remains the reliable fallback.
- Long speech is not constrained by a fixed session duration. Recognition
  remains owner-controlled, while two minutes without any recognized result is
  the inactivity safety boundary; ordinary thinking pauses do not stop it.
- Native developers must use a development build for speech recognition;
  Expo Go remains useful for the rest of the frontend but reports voice input
  as unavailable.
- Spoken output can reveal content to nearby people, so playback remains
  visible, stoppable, and tied to a voice-originated request or explicit replay.
- Always-listening microphones, wake words, background capture, stored audio,
  speaker identification, and automatic transcript submission are forbidden by
  this decision.

## Alternatives considered

- **Add a voice-specific API and orchestration flow:** rejected because it
  duplicates authority and recovery semantics.
- **Upload every recording for server-side transcription:** rejected because
  it adds sensitive binary retention and a transcription-provider dependency
  before either is necessary.
- **Submit automatically when recognition ends:** rejected because a plausible
  but incorrect transcript could trigger work without a deliberate owner
  action. `Stop and send` remains explicit and visible.
- **Depend only on browser speech APIs:** rejected because it abandons the
  accepted universal native frontend.
- **Implement wake-word listening now:** rejected because background capture,
  battery behavior, privacy indication, and interruption policy require a
  separate decision and stronger native operational evidence.

## Follow-up

- Validate microphone permission, transcript review, reply playback, and stop
  behavior on one physical Android or iOS development build.
- Measure recognition failures before deciding whether Vera needs an
  owner-controlled transcription adapter.
- Design background presence and wake-word behavior separately; this ADR does
  not authorize them.
