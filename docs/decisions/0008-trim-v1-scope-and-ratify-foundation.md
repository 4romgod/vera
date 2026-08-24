# ADR-0008: Ratify the Foundation Review and Trim V1 Scope

**Status:** Accepted
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner)

## Context

The foundation documentation (Product Charter, Discovery Record, Domain
Model, System Architecture, Memory and Context, Capability Model, Security
and Trust, V1 Definition, Engineering Method, and ADRs 0001–0007) was
written in a single pass and committed to `codex/foundation-documentation`
without being merged to `main` or reviewed against an acceptance process.
Every document and decision record carried `Status: Proposed` with no
recorded mechanism for a single owner to move anything to `Accepted`.

Separately, the project's own documentation stop condition — "no additional
design document until the structured-model-proposal and
durable-transition/recovery experiments have produced evidence" — had
already been violated: zero of the five experiments listed in the Discovery
Record had run, and the stop condition itself named only two of the five,
an internal inconsistency.

The V1 Definition also specified roughly thirty acceptance criteria spanning
durable state, crash recovery, idempotency, multi-dimension resource and
delegation budgets with child-task inheritance, a formal cancellation
protocol, live steering, and concurrency isolation — more than a solo owner
should commit to building before validating the underlying product idea.

A structured review (the "Decision Register") was produced on 24 August
2026, evaluating all sixteen Proposed documents/ADRs and the fifty-three
open questions across them, and the owner accepted its recommendations.

## Decision

1. `codex/foundation-documentation` is merged into `main`; the repository's
   default branch now carries the foundation documentation.
2. The Product Charter, the Domain Model's core vocabulary and critical
   distinctions, the System Architecture's logical shape and invariants,
   the Capability Model's contract and budget model, Security and Trust,
   the Engineering Method, and ADRs 0001–0006 are Accepted.
3. The Discovery Record is reclassified from `Proposed` to a living
   discovery log — it was never meant to reach `Accepted` the way a spec
   or ADR does.
4. Memory and Context, the V1 capability selection, and ADR-0007's specific
   choice of PostgreSQL remain open on purpose; nothing in this decision
   forces them closed.
5. V1 scope is reduced. Removed or deferred to V1.1: live steering of an
   in-flight run, multi-dimension resource/delegation budgets with
   child-task inheritance, and a formal cancellation protocol. V1 keeps a
   single per-run ceiling, best-effort cancellation, and cancel-and-resubmit
   in place of steering. Full detail is recorded in the revised
   [V1 Definition](../v1-definition.md).
6. The documentation stop condition is corrected to name the three
   experiments that actually gate further design work — structured model
   proposal, durable transition and recovery, and capability boundary —
   and to explicitly defer the other two (local-model boundary, client
   event consumption) as required-later-but-not-gating.
7. The question "which behaviours would make the owner prefer Vera over
   opening a specialist directly" is promoted to the top of the Discovery
   Record's open product questions as the project's primary open question.

## Rationale

A solo-owner project cannot sustain an approval apparatus that only ever
produces `Proposed` documents — the status field must be able to change, or
it is decoration. The foundation's actual content was sound enough to
ratify the low-risk, high-leverage majority of it immediately, while
explicitly preserving genuine open questions rather than forcing premature
answers. Trimming V1 makes the project's own stop condition achievable by
one person in a bounded amount of time, rather than aspirational.

## Consequences

- Accepted documents are now binding on future implementation work; a
  builder can be held to them rather than treating everything as
  provisional.
- The trimmed V1 Definition (v0.2) supersedes the acceptance criteria of
  v0.1; the removed items are not abandoned, only deferred, and are listed
  explicitly as V1 non-goals.
- The project must still answer which request, which capability, and why
  Vera before implementation gates 2 and 5 are satisfied (see
  [V1 Definition](../v1-definition.md#implementation-gates)).
- Future documentation changes should record acceptance the same way: a
  dated `**Accepted:**` line naming the owner, added at the point of
  ratification rather than left as an indefinite `Proposed`.

## Alternatives considered

- **Leave everything Proposed indefinitely:** rejected — an approval status
  that can never change provides no information and blocks nothing real.
- **Accept the full V1 Definition as originally scoped:** rejected — the
  scope was sized for a team, and the first priority is validating the
  product idea, not building the complete execution kernel before any of
  it has been used once.
- **Reject the foundation and restart discovery:** rejected — the domain
  model and safety principles are sound; the problems were procedural
  (no acceptance mechanism, no merge, no experiments) and scope-related
  (V1 too large), not conceptual.
