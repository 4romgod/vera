# Vera Architecture Decision Records

**Status:** Active index
**Last updated:** 24 August 2026

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

ADRs 0001–0008 were accepted 24 August 2026 following the owner's review of
the foundation documentation. ADR-0007 accepted a semantic boundary without
selecting products at that time. ADR-0009 records the owner-directed start of
implementation and the first executable vertical slice. ADR-0010 resolves the
storage decision: MongoDB is authoritative and Redis is a rebuildable
projection. ADR-0010 records the required real-process recovery evidence; that
behavior remains a regression criterion, not an undecided product choice.

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
