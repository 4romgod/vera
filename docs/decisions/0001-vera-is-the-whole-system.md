# ADR-0001: Vera Is the Whole Assistant System

**Status:** Proposed
**Date:** 24 August 2026

## Context

The initial discussion distinguished a model, an orchestrator, Ollama, tools,
memory, and the identity called Vera. Treating any single component as Vera
would make the product's identity disappear whenever that technology changed.

## Decision

Vera is the complete assistant system: identity, domain state, memory, context,
orchestration, policy, models, capabilities, interfaces, and evidence.

A model, provider, framework, database, API, or client is a component of Vera,
not Vera itself.

## Rationale

The owner should experience one coherent assistant even as models, tools,
clients, workflows, and infrastructure evolve. The product promise must live at
a more stable level than any provider.

## Consequences

- Vera's domain and identity must be provider-independent.
- Replacing a model must not replace conversations, tasks, policy, or memory.
- Product documentation describes Vera before describing its implementation.
- Component branding must not leak into core domain terminology unnecessarily.
- The system must define how replaceable components contribute to one coherent
  experience.

## Alternatives considered

- **Vera is a local model:** rejected because the model lacks durable identity,
  tools, authority, and system state.
- **Vera is the orchestrator framework:** rejected because orchestration engines
  are replaceable implementation mechanisms.
- **Vera is the client:** rejected because multiple clients must access the same
  assistant.

## Follow-up

The [Product Charter](../product-charter.md) defines the product promise, and the
[System Architecture](../system-architecture.md) assigns responsibilities to
the replaceable components.
