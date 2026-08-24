# ADR-0004: API-First, Client-Independent Core

**Status:** Accepted
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner)

## Context

The long-term vision includes mobile, desktop, web, voice, images, files, and
notifications. Building a polished multi-platform client before proving Vera's
core would dominate the project and couple assistant semantics to one UI.

The initial discussion agreed that Postman or another HTTP client is sufficient
for the first version and that clients should retain internal flow identifiers
without requiring the owner to speak them.

## Decision

Vera begins with a versioned API as the boundary between its core and clients.
Client applications present conversations and work but do not own orchestration,
policy, memory, or execution truth.

V1 may be operated through Postman or a thin CLI. Rich clients come later.

## Rationale

One core can support several clients, and interface work can evolve without
redesigning Vera's execution system.

## Consequences

- Client-facing resources and events need stable contracts.
- Clients keep opaque identifiers in the background.
- Disconnected clients must be able to recover current state.
- Streaming is a view of durable execution, not execution itself.
- Shared client packages may contain contracts, not privileged server logic.

## Alternatives considered

- **Build the mobile client first:** rejected because the architectural value is
  Vera's orchestration and state, not chat-interface polish.
- **Use only an internal library:** rejected because it would not establish a
  stable multi-client boundary.

## Follow-up

V1 uses `202 Accepted` plus polling. Exact API resources and any later
streaming or notification transport remain illustrative in the
[System Architecture](../system-architecture.md).
