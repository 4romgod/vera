# ADR-0007: Separate Durable State from Model Context

**Status:** Accepted — the separation principle is binding; no persistence
product is selected by this decision
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner)
**Updated:** 24 August 2026 — records the V1 storage hypothesis without
accepting a persistence product

## Context

The initial design used a `scratchpad` to describe temporary state for a flow.
Markdown was considered first, then Redis was selected for concurrency and TTL,
while PostgreSQL was suggested for long-term memory.

That discussion used `scratchpad` for the temporary workspace of a whole active
flow. A later review incorrectly narrowed it to the context of one model call.
Authoritative execution state, the active working set, model context, and
long-term memory have different durability, transaction, privacy, and lifecycle
requirements.

## Decision

Treat tasks, runs, steps, approvals, invocations, events, and artifact metadata
as authoritative durable operational state. Treat the active execution
scratchpad as an isolated, mutable, rebuildable working set for one run. Treat
model context as a smaller, purpose-built projection assembled for one model
invocation.

Do not use Redis, Markdown files, model context, or in-process memory as the sole
source of active-run truth. Anything required for recovery, authorization,
audit, idempotency, or explaining an external effect must exist in the durable
operational record before the effect proceeds.

## V1 experiment hypothesis

Evaluate MongoDB as the authoritative operational store and Redis as the active
execution scratchpad. MongoDB is also the leading later-memory candidate, with
operational state and governed memory kept logically separate.

Redis should hold versioned per-run working sets with explicit expiration. It
must be possible to delete Redis state during a run, rebuild it from MongoDB,
and resume or safely classify the run without losing accepted work or
duplicating an effect.

The experiment must compare this design with MongoDB alone. Neither product nor
the two-store topology is accepted until the extra component demonstrates value
greater than its consistency and operational cost.

## Rationale

Vera must survive process and machine failure, preserve audit history, support
safe concurrency, and prevent retry duplication. Model context should be small,
provider-aware, and disposable rather than becoming the database schema.

## Consequences

- Execution-scratchpad and model-context assembly become explicit, different
  responsibilities.
- Redis can preserve the original fast, expiring scratchpad design without
  becoming authoritative execution truth.
- MongoDB becomes the leading durable-store candidate; PostgreSQL is no longer
  preferred merely for convention when the owner is more effective with
  document databases.
- Process restart and idempotency behaviour must be tested.
- The experiment must cover failure between the durable write and Redis
  projection update rather than assuming dual writes are atomic.
- Markdown remains useful for human documentation and generated reports, not
  runtime coordination.
- Long-term memory remains a separate governed concern even if it shares the
  same database technology.

## Alternatives considered

- **Markdown per flow:** rejected for authoritative concurrent runtime state.
- **Redis as the complete active state store:** rejected because losing the
  scratchpad must not lose accepted work or effect identities.
- **MongoDB alone:** credible and operationally simpler; it becomes the V1
  fallback if Redis does not produce measurable value.
- **PostgreSQL as the durable store:** technically strong, but not preferred for
  this owner-led V1 when MongoDB can satisfy the tested semantics and better
  matches the owner's experience.
- **DynamoDB as the durable store:** credible for a future AWS-first deployment,
  but deferred because V1 is Mac-Mini-first and its access patterns are still
  changing.
- **In-process state only:** rejected because work would disappear on restart.
- **Select a durable workflow engine immediately:** deferred until execution
  semantics are defined and a simpler design is evaluated.

## Evidence required before selecting a backend

- Persist and transition two concurrent runs safely.
- Terminate Vera mid-run and demonstrate deterministic recovery.
- Delete the Redis working set mid-run and rebuild it from MongoDB without
  losing an accepted decision or duplicating an invocation.
- Demonstrate recovery when MongoDB commits a transition but its Redis
  projection update fails.
- Retry an invocation without duplicating a controlled side effect.
- Assemble model context from durable sources without exposing private storage
  representations.
- Enforce application schemas, database validation, document versioning,
  idempotency uniqueness, and concurrent-update protection in the MongoDB
  candidate.
- Document backup, migration, and retention expectations for V1.
