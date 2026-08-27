# ADR-0030: Transcribe owner-controlled recordings through a provider-neutral boundary

**Status:** Accepted
**Date:** 27 August 2026
**Supersedes:** [ADR-0028](0028-treat-device-voice-as-a-reviewed-experience-adapter.md) for microphone capture and transcription

## Context

ADR-0028 used the operating system or browser speech recognizer as a continuous
dictation stream. Physical Android testing showed that this abstraction does
not give Vera ownership of the session: the recognizer ends on silence,
produces overlapping interim and final results, and requires restart loops that
emit repeated system start/stop sounds. Increasing timers cannot correct a
platform service that owns when a recognition session ends.

Vera needs a predictable conversational control: start recording, speak and
pause for as long as needed, then choose either review or send. Transcription
quality and deployment preferences must be changeable without coupling the
frontend, conversation model, or task lifecycle to one vendor.

## Decision

The universal Expo frontend records one bounded audio file with `expo-audio`.
Recording has no silence timer or fixed duration and ends only when the owner
presses one of two controls:

- **Stop** ends capture, transcribes the completed recording once, and places
  the editable text in the existing composer.
- **Stop and send** ends capture, transcribes once, and submits that exact text
  through the ordinary conversation path.

The frontend does not merge interim hypotheses because no interim recognition
exists. It displays elapsed time and a distinct transcription phase. Switching
conversations, starting spoken playback, or unmounting aborts the active voice
session and any in-flight upload.

The API exposes `POST /v1/audio/transcriptions` as an ephemeral experience
endpoint. It accepts only supported compressed audio types, rejects empty or
oversized bodies before provider invocation, and has a 25,000,000-byte ceiling.
The request is buffered only for the synchronous provider call. Raw audio is
never written to MongoDB, Redis, artifacts, task events, conversation history,
or application logs. Only text explicitly sent by the owner becomes durable.

Transcription is a port selected independently from the orchestration brain:

- `openai` sends the completed file to the OpenAI transcription API, defaults
  to `gpt-transcribe`, and is a `third_party` data boundary;
- `whisper_cpp` sends the file to a loopback-only whisper.cpp server and is an
  `owner_controlled` data boundary; and
- `disabled` fails explicitly without pretending that voice is available.

Provider credentials remain server-side. Provider responses and errors are
validated and sanitized. The public client sends a raw binary body rather than
base64 JSON, avoiding approximately one-third encoding overhead. Voice remains
an experience adapter: a transcript has no authority to approve capabilities
or bypass task governance.

`expo-speech` remains the replaceable output adapter. Replies are spoken only
after durable conversation projection and remain explicitly stoppable.

```mermaid
sequenceDiagram
    actor Owner
    participant UI as Expo frontend
    participant API as Vera API
    participant STT as Selected transcription adapter
    participant Chat as Conversation/task path

    Owner->>UI: Start recording
    Note over UI: One continuous recording; silence does not stop it
    alt Review
        Owner->>UI: Stop
        UI->>API: Completed compressed audio
        API->>STT: Ephemeral provider request
        STT-->>API: Final text
        API-->>UI: Validated transcript
        UI-->>Owner: Editable composer draft
    else Send
        Owner->>UI: Stop and send
        UI->>API: Completed compressed audio
        API->>STT: Ephemeral provider request
        STT-->>API: Final text
        API-->>UI: Validated transcript
        UI->>Chat: Ordinary explicit message submission
    end
```

## Consequences

- Pauses are governed by the owner, not voice-activity detection.
- There is one final transcript per recording, eliminating duplicate interim
  and final text accumulation.
- Android no longer cycles a speech-recognition service, so Vera does not cause
  repeated recognizer start/stop cues while the owner is speaking.
- Transcription happens after Stop, so the final text is not live while speech
  is in progress.
- OpenAI mode discloses the completed recording to a third party. Local
  whisper.cpp mode keeps it inside the owner's host but adds local model and
  service operations.
- The 25 MB boundary permits long compressed dictation but prevents unbounded
  memory use. Background capture, wake words, stored recordings, and speaker
  identification remain out of scope.

## Alternatives considered

- **Keep restarting platform speech recognition:** rejected by physical-device
  evidence; restarts create the exact audible and duplicate-result failures the
  owner reported.
- **Realtime cloud transcription:** deferred. It would restore live partial
  text but adds streaming reconnection, ordering, cost, and partial-result
  semantics that are unnecessary for owner-controlled stop/review.
- **Transcribe entirely in the frontend:** rejected because it exposes provider
  credentials or bundles a large model into every client.
- **Persist recordings for retry:** rejected. Voice convenience does not justify
  a new sensitive durable-data class.

## Verification

- Automated tests cover single-upload client behavior, content-type and size
  rejection, adapter request contracts, sanitized failures, transcript merge,
  and efficient recording settings.
- Physical-device acceptance must confirm a recording survives long thinking
  pauses, emits no Vera-triggered restart loop, produces one transcript, and
  preserves the separate Stop and Stop-and-send behaviors.
