# ADR-0056: Coordinate software delivery from observed repository state

**Status:** Accepted
**Date:** 7 September 2026

## Context

Vera's bounded software missions can implement, verify, and publish one pull
request, but ADR-0034 originally required the registered checkout to be clean.
That precondition makes the coordinator brittle in the ordinary situation that
motivates its use: the owner has already started work, asks Vera to review and
complete it, or asks Vera to publish the current result. Rejecting the request
solely because files are staged, unstaged, or untracked ignores useful evidence
that Vera can safely inspect.

Removing the clean-tree check without replacing it would be unsafe. The model
could receive mutable files that were not disclosed in the mission approval,
the final artifact could use a non-reproducible pseudo-revision, and a protected
control file could enter the result through an apparent owner change.

## Decision

A development campaign may begin from either a clean workspace or one exact
adopted working-tree snapshot. This decision supersedes only ADR-0034's clean
checkout precondition and its consequence that every dirty project fails.
ADR-0034's synchronized base, finite policy, separate effects, and exact
approval requirements remain unchanged.

Before creating the campaign approval, deterministic application code verifies
that the checkout is on the configured base branch and that `HEAD` equals the
remote base. It then captures all supported staged, unstaged, and untracked
changes relative to that immutable commit. The snapshot freezes:

- the base revision and a digest of the complete patch;
- every relative path, operation, before/after digest, byte count, and whether
  the file was staged, unstaged, or untracked;
- total file and byte counts bounded by campaign policy, plus the existing
  one-megabyte software-change patch representation ceiling; and
- one digest over the canonical snapshot representation.

V1 adoption accepts only regular, non-executable UTF-8 text files at safe
non-secret, non-instruction paths. Binary files, symlinks, credential-like
paths, agent instruction files, unsupported Git states, and over-limit
snapshots fail explicitly before approval. They are not silently omitted.

The campaign effect discloses whether its starting workspace is clean or
adopted and includes the exact snapshot reference. Approval freezes that
reference. Before each local attempt, Vera recaptures the checkout and requires
an exact match. Any later owner or process change settles at review-required;
Vera cannot refresh the snapshot under the old approval.

Project context retains the immutable Git commit as its revision. For every
adopted update or deletion, it contains the clean baseline document, plus the
complete working-tree patch as a separate integrity-checked evidence object.
The subordinate task receives campaign-derived context and artifact ceilings
that are frozen into its durable run budget. This permits an approved large
text file such as a lockfile without widening the defaults used by ordinary
tasks; the derived ceilings cannot exceed the already-approved campaign or
software-change representation limits.
The software-change adapter commits the clean baseline in an isolated temporary
repository, applies and verifies the adopted patch, and then asks the selected
specialist to review, preserve, correct, complete, or deliberately exclude the
starting work according to the approved objective. Vera computes the final
software-change artifact from the clean baseline to the final isolated state,
so application and publication remain compatible with the existing exact-commit
lifecycles.

Campaign protected paths remain closed to specialist-generated changes. A
protected file already present in the owner snapshot may pass through only if
the final file operation and hashes match the frozen owner version exactly. The
specialist may leave that exact change intact or return the file to its clean
baseline; it may not create or modify protected authority-bearing content.

The conversational model routes explicit end-to-end delivery requests,
including requests to review or publish existing changes, to the mission
coordinator. It does not itself classify Git status, calculate trust, update the
snapshot, or gain GitHub credentials. The existing mission boundary still
creates one campaign, one non-draft pull request, no merge, no recurrence, and
no policy mutation.

## Rationale

Repository state is evidence, not authority. Capturing it before approval lets
Vera reason about real owner work without treating a mutable checkout as an
implicit grant. Keeping the immutable commit as the artifact base preserves
repeatability and reuses the existing application, verification, publication,
recovery, and audit paths.

This is intentionally an evolution of missions and campaigns rather than a new
parallel aggregate. The mission already owns the outcome-level approval; the
campaign already owns attempts, repair evidence, gates, and pull-request
delivery. Adding a second coordinator would duplicate state and introduce
conflicting recovery authority.

## Consequences

- The owner can ask Vera to review current work, complete a bounded feature,
  run configured checks, and produce one pull request without first cleaning or
  committing the checkout.
- Existing changes and Vera's additions produce one inspectable artifact and
  pull-request diff relative to the synchronized base.
- Local gate failures still create bounded replacement attempts. Each attempt
  starts from the same approved owner snapshot rather than from a retired
  generated workspace.
- Snapshot capture and validation are durable inside the existing task and
  campaign records. Older campaign and task records remain parseable because
  the workspace evidence is optional and absence means the historical clean
  mode.
- Any workspace drift, unsupported file, ambiguous Git status, base movement,
  or integrity mismatch fails closed with no application or publication.
- Very large, binary, executable, symlinked, secret-like, or instruction-file
  changes still require the owner to resolve or isolate them before V1 can
  adopt the workspace.
- The coordinator remains bounded to one approved objective and one pull
  request. It does not become a general shell, choose credentials, force-push,
  merge, or run an open-ended autonomous roadmap.

## Alternatives considered

### Require the owner to commit everything first

Rejected because it pushes repository interpretation back onto the owner and
prevents Vera from reviewing the exact unfinished work it was asked to help
with. A temporary owner commit would also manufacture history solely to satisfy
an orchestration limitation.

### Let the coding specialist work directly in the registered checkout

Rejected because it would mix model writes with owner state, weaken recovery,
and make it impossible to prove which input was approved or safely discard a
failed attempt.

### Automatically stash or commit the working tree

Rejected because either action mutates owner state before the exact downstream
effect is approved and creates cleanup and crash-recovery obligations unrelated
to implementation.

### Add an unrestricted “publish whatever is here” capability

Rejected because it would bypass objective review, configured gates, protected
paths, exact application, and the separate publication lifecycle.

## Follow-up

Use owner-supervised missions to evaluate whether binary assets need a separate
opaque-preservation path and whether repository observations should become a
first-class UI review surface. Multi-pull-request programs and automatic merge
remain separate authority decisions.
