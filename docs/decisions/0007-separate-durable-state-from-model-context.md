# ADR-0007: Separate Durable State from Model Context

**Status:** Proposed
**Date:** 24 August 2026

## Context

The initial design used a `scratchpad` to describe temporary state for a flow.
Markdown was considered first, then Redis was selected for concurrency and TTL,
while PostgreSQL was suggested for long-term memory.

That discussion combined authoritative execution state with the temporary
information supplied to a model. The two have different durability, transaction,
privacy, and lifecycle requirements.

## Proposed decision

Treat tasks, runs, steps, approvals, invocations, events, and artifact metadata
as authoritative durable operational state. Treat model context and scratchpad
content as bounded, disposable projections derived from authoritative sources.

Use PostgreSQL as the leading V1 candidate for durable operational state,
subject to a recovery and concurrency experiment. Do not use Redis as the sole
source of active-run truth. Add Redis only for demonstrated transient needs such
as caching, leases, queues, rate limiting, or pub/sub.

## Rationale

Vera must survive process and machine failure, preserve audit history, support
safe concurrency, and prevent retry duplication. Model context should be small,
provider-aware, and disposable rather than becoming the database schema.

## Consequences

- Context assembly becomes an explicit service responsibility.
- Storage is chosen for required semantics rather than the word `scratchpad`.
- Process restart and idempotency behaviour must be tested.
- Redis remains available as supporting infrastructure without being mandatory.
- Markdown remains useful for human documentation and generated reports, not
  runtime coordination.
- Long-term memory remains a separate governed concern even if it shares the
  same database technology.

## Alternatives considered

- **Markdown per flow:** rejected for authoritative concurrent runtime state.
- **Redis as the complete active state store:** not preferred because durability
  and transactional semantics are more important than early caching speed.
- **In-process state only:** rejected because work would disappear on restart.
- **Select a durable workflow engine immediately:** deferred until execution
  semantics are defined and a simpler design is evaluated.

## Evidence required for acceptance

- Persist and transition two concurrent runs safely.
- Terminate Vera mid-run and demonstrate deterministic recovery.
- Retry an invocation without duplicating a controlled side effect.
- Assemble model context from durable sources without exposing private storage
  representations.
- Document backup, migration, and retention expectations for V1.
