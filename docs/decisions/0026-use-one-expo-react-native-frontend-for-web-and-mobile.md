# ADR-0026: Use one Expo React Native frontend for web and mobile

**Status:** Accepted
**Date:** 26 August 2026

## Context

Vera's user interface must be a thin client of the public API and never become
an orchestration or execution authority. Vera is intended to become an ambient
personal assistant, so web and mobile are product surfaces of one assistant
rather than separate products with independently drifting interaction rules.

The repository already uses npm workspaces, and the owner prefers a single
frontend workspace when the platform can preserve native behavior without
duplicating application semantics.

## Decision

Create one npm workspace named `apps/frontend`, published internally as
`@vera/frontend`. Build it with Expo Router, React Native, and React Native Web.
The same route and component implementation targets web, iOS, and Android.

The frontend:

- depends only on `@vera/client` and the versioned public HTTP API;
- renders conversations, project selection, run progress, exact approvals,
  cancellation, governed memory, personal tasks, reminders, and notifications;
- uses platform-native primitives and responsive layouts rather than a
  browser DOM implementation wrapped for mobile;
- takes the API base URL from `EXPO_PUBLIC_VERA_API_URL`, with loopback
  defaults for local web/iOS simulators and the Android emulator host alias;
- polls the durable notification inbox in V1 because React Native streaming
  support varies by runtime; the inbox remains authoritative and cursor-ready;
  and
- contains no model keys, integration credentials, orchestration policy,
  durable authority, or hidden side-effect path.

The API permits browser cross-origin reads only from HTTP(S) loopback origins.
This enables the Expo web development server without widening the V1
host-session perimeter. Native and command-line requests do not send browser
Origin headers. Physical-device access requires a separately accepted remote
owner boundary; the API must not be rebound to the LAN merely to make Expo Go
convenient. ADR-0027 supplies that boundary through private Tailscale Serve
ingress.

## Rationale

One universal workspace makes the interaction contract—the part an owner
experiences as “Vera”—portable without making the server depend on Expo. Expo
Router supplies native and web entry points, React Native Web preserves broad
component reuse, and `@vera/client` continues to isolate transport validation.
Platform-specific modules may be introduced only where behavior genuinely
differs.

## Consequences

- Web, iOS, and Android changes normally ship from one workspace and one set of
  interaction components.
- Native bundles can evolve without cloning conversations, approvals, memory,
  or notification behavior into separate applications.
- The frontend development server and API remain separate processes.
- Mobile simulator and web development work inside the loopback perimeter;
  ADR-0027 permits physical-device testing through private Tailscale Serve
  ingress.
- Polling is less immediate than SSE, but it is portable and does not weaken
  notification durability. A future transport may replace polling behind the
  same resource contract.
- Expo and React Native become replaceable experience-layer dependencies, not
  domain or orchestration dependencies.

## Alternatives considered

- **Build a separate Vite web workspace and a mobile workspace:** rejected
  because it creates two implementations of Vera's primary experience before
  any platform divergence justifies the cost.
- **Embed a web app in native WebViews:** rejected because it does not provide
  a credible native interaction foundation.
- **Move API or orchestration code into Expo routes:** rejected because clients
  must remain untrusted command and projection surfaces.
- **Expose the unauthenticated API on the LAN for physical devices:** rejected
  because convenience does not justify widening the accepted owner perimeter.

## Follow-up

- Replace the private-tailnet owner boundary with application identity before
  shared or multi-user exposure.
- Add push delivery as an adapter over the durable notification inbox.
- Introduce platform-specific voice, background, and notification modules only
  after their authority and privacy boundaries are accepted.
