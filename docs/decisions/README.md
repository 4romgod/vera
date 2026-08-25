# Vera Architecture Decision Records

**Status:** Active index
**Last updated:** 25 August 2026

## Purpose

Architecture Decision Records (ADRs) preserve consequential choices, their
context, alternatives, and consequences. They prevent the project from
re-litigating settled questions without evidence and prevent later edits from
erasing why a choice was made.

## Status meanings

- **Proposed:** recommended and ready for review, but not authoritative.
- **Accepted:** approved and authoritative for its stated scope.
- **Rejected:** evaluated and intentionally not selected.
- **Superseded:** once accepted, but replaced by a later ADR.
- **Deprecated:** still present for compatibility but should not guide new work.

## Decision index

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-vera-is-the-whole-system.md) | Accepted | Vera is the whole assistant system, not a model or framework. |
| [0002](0002-vera-delegates-to-specialist-capabilities.md) | Accepted | Vera is the top-level orchestrator and may invoke specialist orchestrators. |
| [0003](0003-models-propose-code-controls-effects.md) | Accepted | Models provide proposals; application code controls state and side effects. |
| [0004](0004-api-first-client-independent-core.md) | Accepted | Vera begins API-first and clients do not own core semantics. |
| [0005](0005-isolate-independent-streams-of-work.md) | Accepted | Independent work has explicit identity and isolated state/context. |
| [0006](0006-typescript-first-npm-monorepo.md) | Accepted | Use a TypeScript/Node-first monorepo managed initially with npm workspaces. |
| [0007](0007-separate-durable-state-from-model-context.md) | Accepted | Separate authoritative durable state, rebuildable execution scratchpad, and disposable model context without selecting a storage product. |
| [0008](0008-trim-v1-scope-and-ratify-foundation.md) | Accepted | Ratify the foundation review and trim V1 scope to a solo-buildable slice. |
| [0009](0009-implement-the-model-decision-boundary.md) | Accepted | Implement the first production decision boundary as a Fastify/Zod modular TypeScript API with Ollama and deterministic adapters. |
| [0010](0010-use-mongodb-for-operational-truth-and-redis-for-scratchpads.md) | Accepted | Use MongoDB for authoritative V1 task aggregates and Redis for rebuildable, expiring run scratchpads. |
| [0011](0011-use-generic-project-sources-and-bounded-context-snapshots.md) | Accepted | Represent projects generically and disclose only bounded, approved, hash-verified context snapshots to specialists. |
| [0012](0012-late-bind-specialist-platforms-behind-capability-adapters.md) | Accepted | Keep capability semantics provider-neutral and late-bind explicit, auditable specialist adapters. |
| [0013](0013-dispatch-durable-work-with-mongodb-leases.md) | Accepted | Derive asynchronous work from MongoDB state and coordinate workers with expiring per-run MongoDB leases. |
| [0014](0014-use-the-host-session-as-the-v1-owner-boundary.md) | Accepted | Use the authenticated host/SSH session and a code-enforced loopback listener as V1's single-owner perimeter. |
| [0015](0015-select-model-providers-through-explicit-profiles.md) | Accepted | Select Ollama, OpenAI, or Gemini through explicit startup profiles without silent cross-boundary fallback. |
| [0016](0016-freeze-bounded-conversation-context-and-durably-project-replies.md) | Accepted | Freeze bounded prior same-scope complete turns and recover every terminal Vera reply through a durable projection. |
| [0017](0017-produce-software-changes-as-isolated-patch-artifacts.md) | Accepted | Produce software changes as isolated, review-only patch artifacts without mutating or publishing the registered project. |

ADRs 0001–0008 were accepted 24 August 2026 following the owner's review of
the foundation documentation. ADR-0007 accepted a semantic boundary without
selecting products at that time. ADR-0009 records the owner-directed start of
implementation and the first executable vertical slice. ADR-0010 resolves the
storage decision: MongoDB is authoritative and Redis is a rebuildable
projection. ADR-0010 records the required real-process recovery evidence; that
behavior remains a regression criterion, not an undecided product choice.
ADR-0011 ensures the first real project remains acceptance data rather than a
hard-coded architectural dependency.
ADR-0012 makes Codex the first registered planning adapter rather than a
permanent capability or domain dependency.
ADR-0013 makes `202 Accepted` genuinely asynchronous without turning Redis or
an in-process promise into execution authority.
ADR-0014 resolves V1's owner-boundary contradiction without claiming that
loopback itself authenticates HTTP callers. ADR-0015 makes the model gateway
operationally interchangeable while preserving provider-specific privacy,
credentials, readiness, and failure behavior. ADR-0016 turns conversations into
bounded multi-turn model context and complete durable dialogue without treating
history as authority or long-term memory.
ADR-0017 adds the first implementation capability while separating disposable
workspace writes from repository mutation, commits, pushes, and pull requests.

## ADR rules

- Accepted ADRs are not silently rewritten when a decision changes.
- A replacement ADR names the record it supersedes and describes migration.
- Minor wording corrections may be made without changing meaning.
- ADRs decide one coherent issue; detailed specifications live elsewhere.
- A decision may intentionally defer implementation details.

## Template

```markdown
# ADR-NNNN: Decision title

**Status:** Proposed | Accepted | Rejected | Superseded | Deprecated
**Date:** YYYY-MM-DD

## Context

What problem or forces require a decision?

## Decision

What is being decided?

## Rationale

Why is this option preferred?

## Consequences

What becomes easier, harder, required, or forbidden?

## Alternatives considered

What credible alternatives were evaluated?

## Follow-up

What remains to be specified or validated?
```
