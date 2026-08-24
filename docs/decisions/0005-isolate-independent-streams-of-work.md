# ADR-0005: Isolate Independent Streams of Work

**Status:** Accepted
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner)

## Context

The original discussion compared a Vera flow to a ChatGPT chat. A new chat
protects an unrelated topic from contaminating the existing context, while the
client quietly retains the identifier needed to continue a conversation.

The owner explicitly required multiple flows to run at the same time—for
example, development work, a cloud investigation, and a separate conversation.

## Decision

Every independent stream of work has explicit identity and isolated context,
state, authority, events, errors, cancellation, and artifacts. Clients continue
existing work by carrying opaque identifiers and create new work through an
explicit user action.

The original word `flow` is refined into conversation, task, and run in the
proposed domain model; this ADR accepts the isolation requirement without
prematurely fixing every public name or schema.

## Rationale

Explicit identity is more reliable than asking a model to guess whether free
text starts new work or steers existing work. It enables concurrency,
observability, recovery, and client continuity.

## Consequences

- A missing identifier has explicit create semantics rather than accidental
  continuation.
- Steering must name the work it affects.
- Storage and authorization queries are scoped to the relevant identities.
- Concurrency tests must prove absence of cross-task contamination.
- Parent-child relationships are explicit when work is related.

## Alternatives considered

- **Infer new versus continued work entirely from text:** rejected because it is
  ambiguous and unsafe for concurrent execution.
- **Allow only one active flow:** rejected because parallel personal work is a
  foundational requirement.

## Follow-up

The [Domain Model](../domain-model.md) defines the refined entities. V1 defers
live steering and uses best-effort cancellation followed by a new task;
post-V1 steering semantics remain open.
