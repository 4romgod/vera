# ADR-0055: Select neural and device-fallback voices explicitly

**Status:** Accepted
**Date:** 6 September 2026
**Extends:** [ADR-0053](0053-synthesize-speech-through-a-local-provider-boundary.md)
**Supersedes in part:** [ADR-0051](0051-select-device-speech-voices-through-local-preferences.md)

## Context

After Pocket TTS became Vera's primary speech engine, the Settings interface
continued to enumerate operating-system voices. Selecting one of those entries
and pressing the shared preview control still synthesized through Pocket TTS,
so every one of the 184 browser-reported choices sounded like the same neural
voice. The interface accurately named the list as fallback voices, but its
single preview action made two independent engines appear to be one catalog.

The Pocket TTS sidecar already publishes a bounded stock-voice allowlist from
its readiness endpoint. The API previously verified only its configured default
and did not expose the complete catalog or accept a voice per synthesis call.

## Decision

The provider-neutral speech port exposes a default voice and a bounded catalog
of currently available voice identifiers. `GET /v1/speech` refreshes provider
readiness and advertises that catalog. `POST /v1/speech` accepts an optional
voice identifier, validates it against the catalog in application code, and
passes it through the provider adapter. The configured default remains the
choice when the client does not specify a voice.

The frontend stores the selected neural voice as a device-local preference and
sends it on neural synthesis requests. The server remains authoritative over
which identifiers are permitted. If a saved identifier disappears, the client
uses the advertised server default and makes the mismatch visible.

Neural and device fallback controls are separate:

- each advertised neural voice can be selected and previewed through Vera's
  speech API;
- each system voice can be selected and previewed explicitly through
  `expo-speech`;
- rate and pitch remain device-fallback settings because Pocket TTS does not
  currently expose those controls; and
- a configured neural service failure is shown as unavailable and does not
  silently switch a reply to a system voice.

Voice identifiers remain provider-neutral opaque strings in public contracts.
Provider URLs, model state, prompts, and custom reference audio remain private
to the adapter and sidecar.

## Rationale

One truthful control per engine prevents a preview from claiming to exercise a
selection that it ignores. Server-advertised catalogs avoid duplicating Pocket
TTS allowlists in the API or frontend, while validation at both the application
and adapter boundaries fails closed if a stale or invented identifier is sent.

Device-local selection is appropriate for this increment because the existing
voice settings store is device-local and no owner-settings aggregate has yet
been accepted. The server default preserves a consistent Vera identity for new
devices and clients that do not opt into another voice.

## Consequences

- The speech availability response gains an advertised `voices` array, and the
  synthesis request gains an optional `voice` field.
- Loading the voice settings performs one bounded provider readiness check.
- A sidecar restart with a smaller allowlist can invalidate a saved preference;
  the client visibly falls back to the server default.
- The system-voice catalog can still be large, but it is explicitly secondary
  and every preview is guaranteed to use device speech.
- Synchronizing a neural voice across devices remains deferred until Vera has a
  durable, owner-scoped settings lifecycle.

## Alternatives considered

- **Hide all system voices while Pocket TTS is enabled:** rejected because they
  remain useful as an explicit fallback and diagnostic path.
- **Keep one shared preview button:** rejected because it cannot truthfully
  represent two independent synthesis engines.
- **Let the client send any Pocket TTS identifier:** rejected because the
  sidecar allowlist is an operator-controlled safety and support boundary.
- **Persist the choice immediately in MongoDB:** deferred because a general
  owner-settings aggregate should be designed once for voice, notification,
  connection, and future preferences rather than invented for one field.

## Follow-up

- Evaluate the available Pocket TTS stock voices for pronunciation, latency,
  and long-session stability before expanding the production allowlist.
- Move neural voice selection into a durable owner-settings aggregate when that
  cross-device lifecycle is designed.
