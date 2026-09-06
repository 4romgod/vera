# ADR-0054: Remove conversations through a durable tombstone

**Status:** Accepted
**Date:** 6 September 2026
**Extends:** [ADR-0010](0010-use-mongodb-as-authority-and-redis-as-rebuildable-scratchpad.md)
**Extends:** [ADR-0016](0016-bound-conversation-context-and-project-durable-dialogue.md)

## Context

The owner needs to remove unwanted conversations directly from conversation
history. Physically deleting a conversation aggregate is unsafe while linked
tasks may still be executing: their terminal reply projection needs a stable,
idempotent destination. Conversation messages also contain task links that are
part of Vera's audit and recovery history.

## Decision

`DELETE /v1/conversations/{conversation_id}` performs an idempotent,
owner-scoped logical removal. MongoDB records `status: removed`, `removedAt`,
and the aggregate's new `updatedAt`. Removed conversations are excluded from
lists and owner reads, cannot receive another owner message, and cannot be
recovered by replaying the original creation key.

An already-authorized Vera reply may still be projected into the tombstoned
aggregate. This preserves task settlement and replay safety without returning
the conversation to owner-visible history. The deletion response contains only
the conversation ID, removed status, and removal time.

The frontend exposes deletion as a contextual row action. It requires explicit
confirmation, removes the item from local history after the server confirms,
and resets the workspace if the active conversation was removed.

## Rationale

A tombstone makes the owner's history control immediate while retaining the
minimum aggregate needed for task integrity, idempotency, and late projection.
It also gives future retention and physical-erasure work a deterministic set of
records to process.

## Consequences

- Conversation removal does not delete linked tasks, runs, artifacts, or audit
  events.
- The current operation cannot be undone through the public API.
- Storage queries and conversation context assembly must treat only `active`
  conversations as owner-visible.
- Physical erasure needs a separate retention policy that accounts for linked
  authoritative resources.

## Alternatives considered

- **Hard-delete the aggregate immediately:** rejected because an in-flight task
  could lose its reply destination and because linked audit records would
  become ambiguous.
- **Archive instead of remove:** deferred until the owner needs a restorable
  archive workflow.
- **Frontend-only hiding:** rejected because the conversation would reappear on
  refresh and remain visible to every other client.

## Follow-up

- Define retention and verified physical erasure across linked resources before
  claiming that conversation data is permanently deleted.
- Add archive as a distinct reversible state only if the product needs it.
