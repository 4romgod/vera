# ADR-0003: Models Propose; Code Controls Effects

**Status:** Accepted
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner)

## Context

The original discussion clarified that a model should not write directly to
Redis or other infrastructure. A model can interpret a prompt and return a
structured decision, while application code updates state and performs work.

Model output is probabilistic and can be malformed, incorrect, manipulated by
untrusted content, or incompatible with policy.

## Decision

Models may produce structured proposals, plans, classifications, summaries, and
responses. Deterministic application code validates proposals, enforces policy
and approvals, performs authorized side effects, and records events.

The canonical governing principle is owned by the
[Product Charter](../product-charter.md#models-propose-policy-authorizes-code-executes-events-record).
This decision record preserves its architectural rationale and consequences
rather than defining a second version of the wording.

## Rationale

This preserves the usefulness of model reasoning without making it the system's
authorization layer or source of truth.

## Consequences

- Model outputs require versioned schemas and validation.
- Invalid or unauthorized proposals fail safely.
- Models receive capability descriptions, not unrestricted infrastructure.
- Policy and lifecycle transitions must be testable without a live model.
- Model reasoning text does not itself prove that an action was performed.

## Alternatives considered

- **Allow the model to mutate stores and tools directly:** rejected because it
  collapses reasoning, authority, and execution into an unsafe boundary.
- **Use no models in orchestration:** rejected because intent interpretation and
  planning are central parts of Vera's value.

## Follow-up

V1 must demonstrate a valid proposal, invalid proposal, policy denial, and
approval-gated operation using both a deterministic fake and a real model.
