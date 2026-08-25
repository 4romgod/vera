# ADR-0013: Dispatch durable work with MongoDB leases

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera already persists tasks, runs, approvals, invocation identity, events, and
artifacts in MongoDB. Its task-producing HTTP handlers nevertheless performed
model and capability work before returning. That tied execution latency to the
client connection and made `202 Accepted` describe a resource contract without
providing true asynchronous execution.

Vera needs to accept work quickly, continue when a client disconnects, recover
after process failure, and permit more than one API process without executing a
run twice. Redis is deliberately a rebuildable scratchpad under ADR-0010; using
it as an authoritative queue would create a second source of execution truth.

## Decision

Task and approval handlers persist only authoritative transitions and return.
A worker derives dispatchable work from MongoDB task state and advances it
through the existing lifecycle service.

Workers coordinate with one expiring MongoDB lease per run:

- a conditional claim permits only one unexpired lease holder;
- the lease contains a unique token and can be released only by that token;
- an expired lease is reclaimable after process failure;
- the lease duration must exceed the maximum duration of any claimed unit of
  work; and
- all external operations executed while holding a lease have explicit time
  bounds.

The initial worker runs in the API process. This is deployment topology, not a
domain dependency: the worker, lease store, lifecycle, and HTTP boundary remain
separate modules and can later be deployed independently without changing the
task contract.

The worker provides at-least-once recovery, not magical exactly-once delivery.
Durable state transitions use optimistic concurrency, invocation identity is
persisted before capability execution, and artifact creation is idempotent by
invocation ID. Future capabilities with external side effects must provide an
idempotency or reconciliation strategy before registration.

Redis remains the disposable run projection. It is neither the dispatch queue
nor the lease authority.

## Rationale

MongoDB state already expresses whether work is dispatchable. Deriving work
from that state removes an outbox/queue consistency problem and preserves one
authority for execution. Expiring leases add cross-process exclusion without
making a process-local promise or connection the source of truth.

Starting with an in-process worker keeps V1 operable as one deployable service
while establishing the seam needed for a later worker process. A separate
queue can be added when measured throughput or scheduling requirements justify
it, with MongoDB state still governing whether a delivery may act.

## Consequences

- `POST /v1/tasks`, conversation-message submission, and approval decisions
  return after durable acceptance rather than after model or specialist work.
- Clients observe transitions by polling run resources and ordered events.
- A stopped Vera process performs no work; restart rediscovers unfinished work.
- After forced process loss, recovery may wait for at most the configured lease
  duration; graceful shutdown releases the lease immediately.
- Multiple service instances may poll concurrently, but only a lease holder may
  progress a run.
- Lease health and worker liveness are part of readiness.
- The lease collection requires expiry and lookup indexes.
- Graceful shutdown waits for claimed work. Forced shutdown relies on lease
  expiry and idempotent recovery.
- A very long or unbounded capability is invalid unless lease renewal or a
  different durable execution protocol is designed first.

## Alternatives considered

### Fire-and-forget promises in HTTP handlers

Rejected because process failure loses the dispatcher and the promise has no
durable ownership or recovery semantics.

### Redis list or stream as the V1 queue

Rejected for this increment because Redis is intentionally rebuildable and
non-authoritative. Coordinating queue acknowledgement with MongoDB transitions
would require an outbox/inbox protocol before it was safe.

### A separate worker deployment immediately

Deferred. It adds operating complexity without changing the execution
semantics established here. The modular boundary permits the split later.

### Holding work inside the HTTP request

Rejected because it couples accepted work to connection lifetime, prevents a
thin client from recovering naturally, and makes long-running capabilities
fragile.

## Follow-up

- Measure polling and claim contention before selecting a queue or change
  notification mechanism.
- Add lease renewal only if a future accepted capability legitimately exceeds
  the bounded V1 work duration.
- Define idempotency and reconciliation requirements before registering a
  capability that performs non-idempotent external effects.
- Authentication remains a separate pre-exposure decision. Until it is
  designed and implemented, Vera stays loopback-only with the development
  `owner_v1` principal.
