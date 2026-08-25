# ADR-0016: Freeze bounded conversation context and durably project replies

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera persisted owner messages and linked them to tasks, but every orchestration
decision saw only the current message. Completed responses lived only in task
output, so a conversation was neither a usable multi-turn interface nor a
complete record of what Vera said. Simply sending the whole conversation would
mix projects, include concurrent incomplete work, create unbounded cost, and
silently enlarge cloud-provider disclosure.

Task completion and conversation-message persistence are separate durable
writes. Writing only after completion without a recovery record could also lose
Vera's visible reply if the process stopped between those writes.

## Decision

For each conversation task, Vera freezes a versioned context bundle before the
first model call. The bundle contains only prior complete owner/Vera turn pairs
whose scope exactly matches the current message:

- a project-scoped message receives prior turns with the same `projectId`;
- an unscoped message receives only prior unscoped turns;
- incomplete turns and other project scopes are excluded;
- selection keeps the most recent contiguous whole turns within configured
  message and character limits; and
- no individual message is truncated.

The bundle and its manifest are stored in the authoritative task aggregate.
The manifest records message and task identities, roles, SHA-256 content
hashes, character totals, limits, and exclusion counts. The current owner
message remains separate. The model receives the bounded prior messages as
untrusted dialogue: history cannot override the system contract, grant
authority, approve an action, or broaden a capability.

Every terminal conversation task creates a pending Vera-reply projection in
the same atomic aggregate transition that records the terminal result. Its
message identity and idempotency key are deterministic for the task. A worker
appends the reply to the conversation and then records the projection as
complete. Pending projections are dispatchable and recoverable even though the
run is already terminal. Repeating either write cannot create a duplicate
reply. Owner and Vera message idempotency keys occupy separate role namespaces,
so owner-supplied keys cannot reserve deterministic system-reply identities.
Workers also discover terminal conversation aggregates created before this
projection existed and durably backfill their missing reply state.

Direct-response text is projected exactly. Planning results receive a concise
reply containing the plan title, summary, and artifact identity. Rejection,
failure, and cancellation also receive an explicit terminal reply.

Conversation history is operational evidence and bounded short-term context;
it is not governed long-term personal memory. No fact is promoted into future
memory merely because it appeared in a conversation.

Selecting a third-party orchestration provider now authorizes the current owner
message, minimal selected-project identity, and this bounded prior same-scope
conversation text to cross that provider boundary. The audit manifest remains
inside Vera and is validated before disclosure. It still does not
authorize repository contents, credentials, unrelated conversations,
long-term memory, or capability execution. There is no automatic provider
fallback.

## Rationale

Complete turn pairs preserve conversational coherence without presenting a
model with owner messages whose outcomes are still unknown. Exact project
matching prevents one project's work from becoming another's implicit context.
Freezing the bundle makes retries, audits, and provider behavior reproducible
even if the conversation later grows or configuration limits change.

The durable pending projection is a small transactional-outbox pattern inside
the existing aggregate. It preserves the current MongoDB authority and worker
recovery model without requiring a distributed transaction between task and
conversation documents.

## Consequences

- Conversations can now support real follow-up requests through the same API,
  client, and `vera chat` CLI path.
- Model input grows with bounded history; operators can lower
  `CONVERSATION_CONTEXT_MAX_MESSAGES` or
  `CONVERSATION_CONTEXT_MAX_CHARACTERS`.
- Concurrent messages may not see one another until each earlier task has a
  durable Vera reply. This is intentional rather than nondeterministic partial
  context.
- A terminal run may briefly expose a pending reply projection. Clients waiting
  for a conversation task treat projection completion as part of settlement.
- Conversation deletion, retention, summarization, semantic retrieval, and
  long-term memory remain separate future policies.

## Alternatives considered

### Send the complete conversation

Rejected because it is unbounded, crosses project and privacy scopes, and can
include incomplete concurrent work.

### Store only task output and reconstruct replies on reads

Rejected because the conversation would not be an immutable record and clients
could observe different histories as output formatting evolves.

### Append the reply without first recording pending work

Rejected because a process failure between terminal task persistence and the
append could permanently lose the reply.

### Introduce a queue or distributed transaction

Rejected for this increment because MongoDB already contains the authoritative
work-discovery boundary. A recoverable aggregate projection provides the
required guarantee with less operational machinery.

## Follow-up

- Define conversation retention and deletion before storing materially more
  personal history.
- Add governed summarization or retrieval only when bounded recent turns are
  insufficient and their provenance can remain inspectable.
- Add per-request provider routing only with equally explicit disclosure and
  budget policy.
