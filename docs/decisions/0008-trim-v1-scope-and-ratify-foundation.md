# ADR-0008: Ratify the Foundation Review and Trim V1 Scope

**Status:** Accepted
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner)

## Context

The foundation documentation (Product Charter, Discovery Record, Domain
Model, System Architecture, Memory and Context, Capability Model, Security
and Trust, V1 Definition, Engineering Method, and ADRs 0001–0007) was
written in a single pass and squash-merged through pull request #1 as commit
`3ba7997`. It had not yet been reviewed against an explicit acceptance
process. Every normative design document and decision record carried
`Status: Proposed` with no recorded mechanism for a single owner to move
anything to `Accepted`.

Separately, the project's documentation stop condition named two experiments
while the Discovery Record listed five without distinguishing which ones gated
further design. No experiment had run. The condition had not been violated—the
foundation documents preceded it—but the inconsistency made the next permitted
work unclear.

The V1 Definition also specified roughly thirty acceptance criteria spanning
durable state, crash recovery, idempotency, multi-dimension resource and
delegation budgets with child-task inheritance, a formal cancellation
protocol, live steering, and concurrency isolation — more than a solo owner
should commit to building before validating the underlying product idea.

On 24 August 2026, the owner reviewed the foundation, its proposed decisions,
and its unresolved questions and accepted the recommendations recorded here.

## Decision

1. Pull request #1 established the foundation documentation on `main` before
   this ratification. This record corrects the repository history rather than
   claiming a second merge of the foundation branch.
2. The Product Charter, the Domain Model's core vocabulary and critical
   distinctions, the System Architecture's logical shape and invariants,
   the Capability Model's contract and budget model, Security and Trust,
   the Engineering Method, and ADRs 0001–0007 are Accepted. ADR-0007 accepts
   only the durable-state/model-context separation; it does not select
   PostgreSQL or another backend.
3. The Discovery Record is reclassified from `Proposed` to a living
   discovery log — it was never meant to reach `Accepted` the way a spec
   or ADR does.
4. Broader Memory and Context policy and the persistence backend remain open on
   purpose; nothing in this decision forces them closed.
5. The revised V1 Definition v0.3 is Accepted as an experimental scope. Removed
   or deferred to V1.1: live steering of an in-flight run, hierarchical
   child-task budgets and delegation, and a formal cancellation protocol. V1
   keeps flat finite ceilings for model calls, capability invocations, retries,
   elapsed work, and measurable spend or usage; forbids recursive delegation;
   uses best-effort cancellation; and uses cancel-and-resubmit in place of
   steering. Full detail is recorded in the revised
   [V1 Definition](../v1-definition.md).
6. The documentation stop condition is corrected to name the three
   experiments that actually gate further design work — structured model
   proposal, durable transition and recovery, and capability boundary —
   and to explicitly defer the other two (local-model boundary, client
   event consumption) as required-later-but-not-gating.
7. V1 will test one product hypothesis: the owner asks Vera to prepare an
   implementation plan for a Gatherle ticket; Vera assembles bounded read-only
   context, obtains approval before sending it to the cloud Codex-backed
   `development_planning@1` capability, and stores one versioned plan artifact.
   Whether this controlled orchestration is meaningfully better than opening
   the specialist directly remains an experiment outcome, not an assumed fact.

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
- The trimmed V1 Definition (currently v0.4) supersedes the acceptance criteria
  of v0.1; the removed items are not abandoned, only deferred, and are listed
  explicitly as V1 non-goals.
- The project must validate, rather than merely assert, that the selected
  journey demonstrates a reason to use Vera instead of opening Codex directly.
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
