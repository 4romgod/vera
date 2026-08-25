# ADR-0018: Apply approved software changes in managed Git worktrees

**Status:** Accepted
**Date:** 25 August 2026

## Context

ADR-0017 deliberately ended software implementation at a durable, reviewable
patch artifact. That boundary prevents a specialist from silently mutating the
owner's registered checkout, but it leaves the owner to apply every accepted
artifact manually. Vera now needs a controlled application effect without
combining local mutation with commit, push, or pull-request authority.

Applying a patch is not a harmless continuation of artifact creation. It can
conflict with newer source, be duplicated after process loss, race with another
change to the same project, or leave a partial filesystem effect. Approval must
therefore identify the exact effect and recovery must inspect reality rather
than trust an earlier process claim.

## Decision

Introduce a first-class `SoftwareChangeApplication` resource with its own
identity, status, ordered events, idempotency key, approval, effect, result, and
failure record. It is separate from the task that produced the artifact.

Before requesting approval, Vera freezes and discloses:

- the source artifact ID and SHA-256 hash;
- the registered project ID;
- the immutable Git base commit;
- the exact patch SHA-256 hash and file manifest;
- the deterministic managed branch and workspace path; and
- the fact that the resulting change will be staged but not committed.

The initial `local_git_worktree` adapter accepts only artifacts produced from a
clean immutable commit. It creates a deterministic branch and a durable managed
Git worktree below `CHANGE_APPLICATION_ROOT`, applies the approved patch with
`git apply --index`, then independently verifies after-state hashes and the
exact staged file/status set. The owner's registered checkout remains
unchanged. Vera does not commit, push, force-update a branch, open a pull
request, or use repository credentials.

MongoDB is authoritative for persistent application records. A project-scoped,
expiring MongoDB lease prevents two workers from mutating worktrees for the
same registered project concurrently. Optimistic version checks protect state
transitions. The in-memory implementations satisfy the same ports for bounded
local and deterministic tests.

Recovery classifies the managed filesystem effect:

- exact before-state: resume application, or remove the managed worktree when
  cancellation is pending;
- exact after-state plus exact Git index: record success idempotently;
- mixed, occupied, or unexpected state: fail closed as `review_required`;
- stale source or a patch that no longer applies: record a distinct conflict.

Cancellation never claims that an already-staged effect was reversed. If
cancellation races with completion, reconciliation records success when the
exact approved effect exists; otherwise it removes an untouched managed
worktree and records cancellation.

## Rationale

A managed worktree gives Vera a useful local result while keeping the owner's
active checkout isolated. Exact approval and filesystem-derived verification
preserve the core rule that models propose and deterministic code controls
effects. A separate durable resource also gives application a different
approval, idempotency, concurrency, and recovery contract from artifact
production.

## Consequences

- An approved software-change artifact can be applied end to end through HTTP,
  the shared client, and the owner CLI.
- Managed worktrees and branches are durable review surfaces, not temporary
  generation sandboxes.
- Operators must configure storage for `CHANGE_APPLICATION_ROOT` and include it
  in lifecycle/cleanup planning.
- Per-project serialization is intentionally more conservative than maximum
  throughput.
- A successful application still requires an explicit later decision before
  commit or publication.
- Existing artifacts with mutable `+working-tree` revisions are not applicable;
  a new artifact must be produced from a clean commit.

## Alternatives considered

### Apply directly in the registered checkout

Rejected because owner edits, untracked files, IDE state, and retries would be
mixed with Vera's effect and rollback would be ambiguous.

### Treat patch application as part of `software_change@1`

Rejected because generating an artifact and mutating a repository require
different authority and have different recovery semantics.

### Run an arbitrary shell command supplied by a model

Rejected because it has no bounded effect contract, exact approval disclosure,
or deterministic reconciliation rule.

### Commit and push after staging

Deferred. Commit authorship, remote credentials, branch publication, and pull
requests require a separate accepted capability and approval.

## Follow-up

- Add a distinct commit/publication operation only after its authority,
  credential, remote-race, retry, and rollback semantics are accepted.
- Define operator-visible retention and cleanup for terminal managed worktrees.
- Add another change-application adapter only if it preserves the same exact
  approval and reconciliation guarantees.
