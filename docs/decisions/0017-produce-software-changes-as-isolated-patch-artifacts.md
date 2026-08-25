# ADR-0017: Produce software changes as isolated patch artifacts

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera can already turn project-scoped intent into an approved implementation
plan. The next useful development increment must do real implementation work
without collapsing several distinct authorities into one broad “coding” action.
Editing a disposable workspace, mutating the owner's registered repository,
committing, pushing, and opening a pull request have different effects and must
not be authorized by one vague approval.

The specialist also cannot be allowed to define the authoritative result. A
model-written claim that a file changed or a test passed is evidence to inspect,
not proof of the filesystem effect. The result must remain usable if Codex is
later replaced by Claude Code or another implementation.

## Decision

Add the provider-neutral `software_change@1` capability. Its semantic promise
is:

> Given exact approved project context and owner-approved arguments, produce a
> reviewable, versioned patch artifact from an isolated workspace.

The capability does not mutate the registered project, apply a patch, commit,
push, open a pull request, use project credentials, or obtain authority to do
any of those things. A future operation that applies or publishes a change must
have its own capability contract, current-base validation, policy, approval,
idempotency semantics, and recovery design.

The initial production adapter is `codex_cli`; `deterministic_change` is the
owner-controlled conformance adapter. Adapter selection is independent from
the orchestration model and from the planning adapter. Existing destination
descriptors identify the selected adapter, provider, transport, and data
boundary in the approval and artifact.

For the Codex adapter, Vera:

1. validates and materializes only the approved, hash-verified context in a
   newly created temporary workspace;
2. creates a local Git baseline for that snapshot;
3. invokes Codex ephemerally with user configuration and repository agent
   rules disabled, a workspace-write sandbox, and an explicit prohibition on
   network access, commits, pushes, pull requests, credentials, and writes
   outside the workspace;
4. launches the specialist with an allowlisted process environment that omits
   Vera model keys, datastore configuration, profiles, and other unrelated
   server state;
5. accepts only a small structured summary, verification report, and risk list
   from the specialist;
6. stages and inspects the resulting workspace itself, rejecting empty,
   binary, symlink, escaping, credential-like, instruction-file, build-output,
   or over-budget changes; and
7. computes the authoritative Git patch, operations, byte counts, and before/
   after SHA-256 hashes before persisting one `software_change` artifact keyed
   by invocation identity.

The approved snapshot is deliberately partial and bounded. A specialist must
report verification as `not_run` when the snapshot lacks dependencies or files
needed to run it honestly.

## Rationale

A patch artifact is the smallest end-to-end implementation outcome that is
useful, durable, auditable, and recoverable without granting Vera authority over
the owner's working tree. It lets the owner inspect the exact result and keeps
application and publication as explicit later decisions.

Computing the patch outside the model separates generated explanation from
observed effect. Keeping `software_change@1` distinct from
`development_planning@1` also makes intent routing and approvals precise while
reusing Vera's established task, context, destination, budget, artifact, and
recovery boundaries.

## Consequences

- The model may propose `software_change@1`, but Vera code supplies project
  identity, frozen context, limits, destination, invocation identity, and
  approval state.
- The CLI exposes `vera change`; it refuses to auto-approve any capability other
  than `software_change@1`. `vera plan` applies the reciprocal restriction.
- Startup readiness includes the selected software-change adapter.
- A successful task returns a `software_change` output and versioned artifact
  containing the patch and observed file metadata.
- The original repository remains untouched even after approval. Owners apply
  or reject the artifact outside this capability.
- Codex remains replaceable. Another adapter must satisfy the same contract and
  isolation/conformance tests; its actual destination remains visible.
- A bounded partial snapshot can make some changes or verification impossible.
  That limitation is surfaced instead of granting broader implicit access.

## Alternatives considered

### Let Codex edit the registered repository directly

Rejected because approval of context disclosure would silently become approval
to mutate owner state, while failures and retries could leave ambiguous partial
effects.

### Let the specialist return a patch as trusted structured output

Rejected because the model could report content, file identities, or hashes
that do not match what it actually produced. Vera must derive effect evidence
from the isolated filesystem.

### Commit or open a pull request in the same capability

Rejected because local mutation, commit authorship, network publication, and
remote-provider side effects require different authority and idempotency
contracts.

### Name the capability after Codex

Rejected by the late-binding rule in
[ADR-0012](0012-late-bind-specialist-platforms-behind-capability-adapters.md).
The required outcome is a software change, not use of one vendor.

## Follow-up

- Add an explicit artifact-application capability only after its stale-base,
  conflict, rollback, and approval semantics are designed.
- Add a publication capability separately if Vera is to create branches,
  commits, pushes, or pull requests.
- Add another production adapter only with the same isolation and result-
  derivation evidence.
