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

ADRs 0001–0008 were accepted 24 August 2026 following the owner's review of
the foundation documentation. ADR-0007 accepts a semantic boundary, not a
storage product. MongoDB plus a rebuildable Redis scratchpad is the current V1
experiment hypothesis; the durable backend and two-store topology remain
unselected pending the durable-transition/recovery experiment.

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
