# ADR-0051: Select device speech voices through local preferences

**Status:** Accepted
**Date:** 6 September 2026
**Extends:** [ADR-0030](0030-transcribe-owner-controlled-recordings-through-a-provider-neutral-boundary.md)
**Extends:** [ADR-0048](0048-conduct-live-conversations-through-a-durable-voice-session-adapter.md)

## Context

Vera uses the operating system speech synthesizer for Read aloud and live-voice
replies. This keeps private reply text on the owner's device and avoids another
resident model on the Mac Mini, but accepting the platform default makes Vera's
voice arbitrary and often robotic. A configured voice identifier is not a
portable answer: browser, Android, and iOS voice catalogs differ, identifiers
can disappear when voices are uninstalled, and the same owner may use Vera from
several devices.

The setting is presentation preference, not durable assistant knowledge or
execution authority. It does not belong in MongoDB, Redis, model context, or a
server environment profile.

## Decision

The Expo frontend owns a versioned, device-local speech preference containing
an optional voice identifier plus bounded speaking rate and pitch. It persists
through Expo SQLite's synchronous `localStorage` compatibility layer so the
same application contract works on native and web. Failure or malformed data
falls back to conservative defaults and never prevents a conversation.

The dedicated Voice settings tab enumerates `expo-speech` voices supplied by
the current operating system or browser and explicitly labels them as device
speech rather than neural AI voices. It
offers selection, search, preview, catalog refresh, rate, pitch, and reset. An
explicit voice is used only while that identifier remains available. Automatic
selection deterministically prefers:

1. an enhanced voice for the exact configured locale;
2. the device default when it matches the exact locale;
3. an enhanced or device-default voice for the same base language; then
4. the operating-system default.

Vera does not guess among otherwise unranked installed voices. Some operating
systems expose novelty synthesizers alongside ordinary voices, so choosing the
first name alphabetically can be much worse than leaving the choice to the
platform.

The resolved voice language, rate, and pitch are applied by the single shared
spoken-reply adapter. Consequently Read aloud, live conversation, and preview
cannot drift into separate voice configurations. Preview interrupts current
playback and does not create a message, task, speech-delivery claim, or server
record.

Voice catalogs and selections remain device-local. Vera does not send the
catalog to the API or model and does not pretend that one browser voice exists
on a phone. A future premium or server-side synthesizer must remain behind a
separate provider-neutral speech-output boundary; this decision does not make
`expo-speech` a domain dependency.

## Rationale

This makes Vera sound intentionally chosen today without weakening the privacy,
durability, or authority boundaries of live voice. Automatic ranking provides
a useful first run, while explicit preview and selection recognize that voice
quality and personal taste cannot be inferred reliably in code.

## Consequences

- Voice preference changes take effect immediately on the current device.
- A saved voice missing from a device is visible in the UI and safely falls
  back instead of selecting the wrong identifier.
- Native builds include Expo SQLite and the community slider; both remain
  compatible with the universal Expo workspace.
- Clearing application/site data resets the voice, rate, and pitch.
- Device TTS quality remains bounded by voices installed on that device.
- Ordinary and novelty catalog voices remain available through explicit browse,
  but are not promoted as recommendations.

## Alternatives considered

- **One environment-configured voice ID:** rejected because identifiers are not
  portable between platforms or installations.
- **Store the preference in Vera's operational database:** rejected because a
  device-specific identifier would create broken cross-device synchronization.
- **Add hosted neural TTS immediately:** deferred because it adds cost, network
  latency, credentials, and a new privacy boundary before the existing local
  option is made configurable.

## Follow-up

Evaluate a provider-neutral premium speech-output adapter only when device
voices remain materially inadequate after owner selection and tuning.
