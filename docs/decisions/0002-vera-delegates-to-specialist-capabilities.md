# ADR-0002: Vera Delegates to Specialist Capabilities

**Status:** Proposed
**Date:** 24 August 2026

## Context

Vera is not expected to be the best coder, cloud operator, researcher, or
specialist conversational system. Existing and future workflows may already be
excellent at those responsibilities.

The original development example contained its own planner, reviewer,
developer, code reviewer, deterministic quality gate, and pull-request process.
That workflow is itself an orchestrator.

## Decision

Vera acts as the top-level personal orchestrator and may invoke other
orchestrators, agents, tools, services, or deterministic functions through
versioned capability contracts.

Vera retains ownership of the user relationship, top-level task, authority,
and coherent result. A specialist owns the bounded delegated execution.

## Rationale

Specialists can improve independently and receive only the context and
permissions relevant to their responsibility. Vera can add capabilities without
absorbing all specialist implementation detail into its kernel.

## Consequences

- A capability registry and invocation boundary are required.
- Specialist workflows must not depend on Vera's private storage layout.
- Delegated authority, progress, cancellation, errors, and artifacts need
  explicit contracts.
- Vera needs a rule for direct response versus delegation.
- Nested orchestration is subject to the resource and delegation budgets owned
  by the [Security and Trust Model](../security-and-trust.md#resource-and-delegation-budgets).

## Alternatives considered

- **One general agent performs everything:** rejected because it couples all
  tools, context, permissions, and failure modes into one opaque loop.
- **The user selects every specialist manually:** rejected as the normal path
  because it violates Vera's single-entry-point promise.

## Follow-up

See the [Capability Model](../capability-model.md) for the proposed integration
contract and the V1 capability decision still required.
