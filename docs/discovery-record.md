# Vera Discovery Record

**Status:** Living discovery log — not subject to owner acceptance like a
spec or decision record; see [docs/README.md](README.md#authority-model)
**Version:** 0.1
**Last updated:** 24 August 2026

## Purpose

This document records what is currently understood, what is merely
recommended, and what remains unknown. It exists to prevent brainstorming,
assumptions, and generated prose from becoming accidental decisions.

It is a living discovery artifact. Accepted architectural decisions should
eventually move into dedicated decision records rather than remaining buried
here.

## Inputs reviewed

The initial discovery considered:

- the original conversation that developed the Vera concept;
- the two draft documents produced during that conversation;
- a video transcript describing an architect-builder software workflow;
- the current repository, which contained only a one-line README;
- the owner's current experience and preferences: strongest in the Node/npm
  ecosystem, able to work in Python, and interested in a monorepo supporting
  future clients.

The raw conversation and transcript are source material, not project authority.
They are intentionally not copied into this repository.

## Current product direction

The following ideas have strong support but remain proposed until the Product
Charter is accepted:

- Vera is a personal AI orchestration system and consistent user interface.
- Vera is the whole system rather than one model or framework.
- Vera should select and coordinate specialist capabilities.
- Independent work must be isolated and may run concurrently.
- Clients should not own Vera's business logic.
- The owner must be able to inspect, steer, approve, retry, and cancel work.
- Models must not directly mutate authoritative state or exercise unrestricted
  credentials.
- V1 should prove the architectural spine rather than imitate a complete
  consumer assistant.

## Decision candidates from initial discovery

The original conversation established several strong directions. They are
recorded as proposed decisions until the owner accepts the Product Charter and
reviews each record:

| Decision | Record |
|---|---|
| Vera is the whole assistant system, not a model or framework. | [ADR-0001](decisions/0001-vera-is-the-whole-system.md) |
| Vera delegates bounded work to specialist capabilities and orchestrators. | [ADR-0002](decisions/0002-vera-delegates-to-specialist-capabilities.md) |
| Models provide reasoning; code and policy control effects. | [ADR-0003](decisions/0003-models-propose-code-controls-effects.md) |
| Vera begins API-first and remains client-independent. | [ADR-0004](decisions/0004-api-first-client-independent-core.md) |
| Independent work has explicit identity and isolated state and context. | [ADR-0005](decisions/0005-isolate-independent-streams-of-work.md) |

Later recommendations for a TypeScript/npm monorepo and for separating durable
state from model context are also proposed in [ADR-0006](decisions/0006-typescript-first-npm-monorepo.md)
and [ADR-0007](decisions/0007-separate-durable-state-from-model-context.md).

## Engineering-method learnings

The architect-builder material supports the following working method:

- Treat version-controlled files as the durable engineering handoff.
- Use a discovery gate rather than inventing answers to unresolved questions.
- Keep root-level agent instructions short and use them as a context router.
- Give implementation work explicit requirements, a bounded design,
  acceptance criteria, risks, and a verification plan.
- Begin high-risk work with a builder-understanding checkpoint.
- Use fresh task context for bounded units of work.
- Feed completed work back into durable documentation when it changes the
  system's accepted design.

The following parts of the demonstrated workflow are not adopted:

- a large pre-generated scaffold of empty documents;
- a fixed four-file package for every change regardless of size;
- manual copying of generated architect packs as a long-term integration;
- treating a second model's agreement as validation;
- using repository Markdown as runtime operational state.

## Recommended technology direction

These are recommendations, not accepted decisions.

| Concern | Recommendation | Confidence | Reason |
|---|---|---:|---|
| Repository model | Monorepo | High | Closely related services, clients, contracts, and adapters are expected. |
| Primary language | TypeScript | High | Owner proficiency, Node ecosystem, shared client contracts, and strong AI/tooling support. |
| Primary runtime | Node.js | High | Natural fit for the TypeScript control plane and streaming API workloads. |
| JavaScript package manager | npm workspaces | High | Familiar and sufficient until a concrete limitation appears. |
| Initial CLI | TypeScript | Medium | It can share a generated API client and event contracts. |
| Python | Secondary capability runtime managed with `uv` | High | Use where Python libraries provide a real advantage. |
| Java/JVM | Capability-specific only | High | No foundational requirement currently justifies another core runtime. |
| Contract format | Language-neutral HTTP/events plus OpenAPI or JSON Schema | High | Prevents TypeScript internals from becoming cross-process contracts. |
| Durable operational store | PostgreSQL candidate | Medium | Likely fit for authoritative state and transactional transitions; semantics must be defined first. |
| Redis | Defer | High | Add only for demonstrated caching, locking, queueing, or transient coordination needs. |
| Agent framework | Defer | High | Domain and execution semantics must be defined before evaluating frameworks. |
| Durable workflow engine | Defer | High | Recovery, retry, cancellation, and idempotency requirements must come first. |
| Mobile client | React Native candidate | Medium | Fits the TypeScript ecosystem, but no client should be scaffolded during foundation design. |

## Working assumptions

These assumptions allow discovery to progress but must not be treated as
accepted facts:

- Vera begins as a single-owner personal system.
- The first interface can be an HTTP client or thin CLI rather than a GUI.
- The initial deployment is Mac-Mini-only. V1 does not need to keep
  working while that machine is offline or restarted; revisit after V1
  works once. (Confirmed 24 August 2026 — see Open system questions 1–2.)
- Cloud model providers and local models may both be used.
- At least one real specialist capability must be delegated to in V1.
- Long-term personal memory can be delayed, but identity, authorization, and
  durable operational state cannot be deferred entirely.
- The exact source layout should follow deployable processes and trust
  boundaries rather than precede them.

## Open product questions

1. **Which behaviours would make the owner prefer Vera over opening a
   specialist directly?** Flagged 24 August 2026 as the project's primary
   open question — answer it before resolving the rest of this list.
2. What is the first real end-to-end user request Vera must handle?
3. Is the first specialist capability software development, research,
   cloud operations, or something smaller and safer?
4. How proactive may Vera be without an explicit request?
5. Which classes of action always require approval?
6. What information may Vera retain automatically, and for how long?
7. What should Vera do when intent is ambiguous or no suitable capability is
   available?

## Open system questions

1. ~~Is the initial deployment local-only, cloud-hosted, or hybrid?~~
   Resolved by working assumption, 24 August 2026: local-only (Mac Mini).
2. ~~Must active work continue when the Mac Mini is offline or restarted?~~
   Resolved by working assumption, 24 August 2026: no.
3. What availability and recovery guarantees are required for V1? — the
   durable-transition/recovery experiment answers this for the single-node
   case; multi-node guarantees stay out of scope.
4. How will a client receive progress: polling, server-sent events, WebSockets,
   notifications, or a combination?
5. How are credentials brokered without exposing secrets to models?
6. What is the minimum capability protocol needed for progress, cancellation,
   retries, approvals, artifacts, and errors?
7. What are the exact semantics of steering work that is already running?
8. How will local and remote capabilities authenticate with Vera?
9. Which information is safe to send to cloud model providers?
10. What numerical cost, time, retry, invocation, and delegation-depth ceilings
    should V1 use within its required budget mechanism?

## Required experiments before architecture approval

These experiments are now the next project work. As of 24 August 2026, three
of the five gate further design work; the other two are required before
later work but do not block the gate. See
[ADR-0008](decisions/0008-trim-v1-scope-and-ratify-foundation.md).

### Structured model proposal — required, gates further design

Demonstrate that a TypeScript service can request and validate a structured
proposal from at least one model provider, reject invalid output, and operate
against a deterministic fake during tests.

### Durable transition and recovery — required, gates further design

Persist a task and run, interrupt the application during execution, restart it,
and prove that work is recovered or safely classified without duplicating a
side effect.

### Capability boundary — required, gates further design

Invoke one external capability through a versioned schema and capture progress,
result, failure, and cancellation without giving the capability direct access
to Vera's internal database representation.

### Local-model boundary — deferred

Demonstrate a minimal provider adapter against Ollama without allowing
Ollama-specific response shapes to leak into Vera's domain model. Not
required before V1: V1 needs one real model provider, not necessarily a
local one.

### Client event consumption — deferred

Use a minimal HTTP client to create work and observe ordered execution events.
The experiment should inform, not prematurely fix, the streaming transport.
Not required before V1 implementation begins; informs the V1.1 client work.

## Principal risks

| Risk | Consequence | Early mitigation |
|---|---|---|
| Flow becomes an overloaded concept | Persistent API and storage confusion | Use the explicit domain model before creating schemas. |
| Model output is treated as authority | Unsafe or incorrect side effects | Validate proposals and enforce deterministic policy. |
| Framework owns Vera's semantics | Vendor lock-in and difficult migrations | Keep domain entities and contracts framework-independent. |
| Redis becomes the only active-state store | Lost or incoherent work after failures | Define durability first and use an authoritative store. |
| Credentials enter prompts or logs | Security compromise | Use scoped handles and a credential broker boundary. |
| Documentation becomes generated clutter | Builders receive noisy or contradictory context | Create only purposeful artifacts and assign authority clearly. |
| Shared monorepo packages become a grab bag | Clients gain server-only dependencies or secrets | Define runtime and trust boundaries before package layout. |
| Multi-agent complexity arrives early | Non-determinism without user value | Prove one bounded delegation path first. |
| Model or capability loop consumes unbounded resources | Unexpected cost, unavailable service, or uncontrolled delegation | Enforce finite run budgets and inherited child limits in deterministic policy. |
| Memory stores unsupported inference as fact | Loss of user trust | Record provenance, confidence, scope, and deletion rules. |

## Explicit non-decisions

The project has not selected:

- an API framework;
- an agent or graph framework;
- a durable workflow engine;
- an ORM;
- Redis;
- a production database topology;
- a streaming protocol;
- an authentication provider;
- a mobile or web framework;
- a monorepo task runner;
- an exact source-code folder structure;
- a model provider as Vera's permanent default.

The logical component boundaries and illustrative API are documented in the
[System Architecture](system-architecture.md). They do not override this list of
non-decisions.

## Decision process

Consequential decisions should use one of these statuses:

- **Proposed:** ready for evaluation but not authoritative.
- **Accepted:** approved for implementation.
- **Rejected:** evaluated and intentionally not selected.
- **Superseded:** previously accepted but replaced through an explicit change.

An accepted decision should state its context, selected option, alternatives,
consequences, migration considerations, and evidence. Avoiding all future
change is not realistic; making change explicit and safe is the objective.
