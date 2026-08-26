# Vera Discovery Record

**Status:** Living discovery log — not subject to owner acceptance like a
spec or decision record; see the
[Documentation Guide](README.md#authority-model)
**Version:** 0.6
**Last updated:** 26 August 2026

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
  future clients; experienced with MongoDB and DynamoDB, able to write SQL but
  less inclined to maintain a SQL-first system.

The raw conversation and transcript are source material, not project authority.
They are intentionally not copied into this repository.

## Current product direction

The following directions are now supported by the accepted Product Charter and
foundation decisions:

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
- Assistant usefulness should grow through closed, replaceable integration
  actions rather than by giving a model unrestricted generic tools.

## Decision candidates from initial discovery

The original conversation established several strong directions. The owner
accepted their decision records during the foundation review:

| Decision | Record |
|---|---|
| Vera is the whole assistant system, not a model or framework. | [ADR-0001](decisions/0001-vera-is-the-whole-system.md) |
| Vera delegates bounded work to specialist capabilities and orchestrators. | [ADR-0002](decisions/0002-vera-delegates-to-specialist-capabilities.md) |
| Models provide reasoning; code and policy control effects. | [ADR-0003](decisions/0003-models-propose-code-controls-effects.md) |
| Vera begins API-first and remains client-independent. | [ADR-0004](decisions/0004-api-first-client-independent-core.md) |
| Independent work has explicit identity and isolated state and context. | [ADR-0005](decisions/0005-isolate-independent-streams-of-work.md) |

Later recommendations for a TypeScript/npm monorepo and for separating durable
state from model context are accepted in [ADR-0006](decisions/0006-typescript-first-npm-monorepo.md)
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

## Technology direction

TypeScript, Node.js, npm workspaces, and the monorepo model are accepted through
ADR-0006. Fastify, Zod, the first modular-monolith source layout, and the Ollama
adapter boundary are accepted through ADR-0009. MongoDB operational truth and
Redis scratchpads are accepted through ADR-0010. The trusted V1 host perimeter
is accepted through ADR-0014, and explicit Ollama/OpenAI/Gemini startup profiles
through ADR-0015. Other entries remain recommendations or explicit deferrals.

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
| API framework | Fastify 5 | High | Provides a schema-first HTTP boundary while leaving the domain framework-independent. |
| Runtime schema | Zod 4 producing draft-07 JSON Schema at external boundaries | High | Keeps runtime validation and TypeScript types aligned; real Ollama structured-output evidence passed. |
| Model providers | Explicit startup registry with Ollama, OpenAI, and Gemini adapters | High | Preserves one domain port while keeping credentials, schema dialects, usage, failures, and data boundaries provider-specific. |
| Initial source layout | Modular monolith in `apps/api` | High | Preserves internal boundaries without speculative packages or services; shared packages wait for a second consumer. |
| Durable operational store | MongoDB selected for V1 | High | A versioned aggregate and optimistic compare-and-swap preserve transition state and events atomically while matching owner expertise. |
| Active execution scratchpad | Redis selected for V1 | High | Holds a versioned, TTL-bound projection with stale-write protection and no exclusive authority. |
| Long-term memory store | MongoDB candidate, later | Medium | Operational records and governed memory may share a deployment but must keep separate semantics, access, and retention. |
| PostgreSQL | Fallback, not preferred | Medium | Technically strong, but no longer the leading candidate given owner maintainability and a credible MongoDB design. |
| DynamoDB | Revisit for AWS-first deployment | Medium | Familiar and capable, but introduces a cloud dependency and early access-pattern commitment into the Mac-Mini-first V1. |
| Agent framework | Defer | High | Domain and execution semantics must be defined before evaluating frameworks. |
| Durable workflow engine | Defer | High | Recovery, retry, cancellation, and idempotency requirements must come first. |
| Mobile client | React Native candidate | Medium | Fits the TypeScript ecosystem, but no client should be scaffolded during foundation design. |

## Working assumptions

These assumptions allow discovery to progress but must not be treated as
accepted facts:

- Vera begins as a single-owner personal system.
- The first interface can be an HTTP client or thin CLI rather than a GUI.
- The initial deployment is Mac-Mini-only. No work executes while that machine
  is offline, but durable state must survive and be recovered or safely
  classified after restart. Revisit continuous availability after V1 works
  once. (Confirmed 24 August 2026 — see Open system questions 1–2.)
- Cloud model providers and local models may both be used.
- At least one real specialist capability must be delegated to in V1.
- V1 persistent mode uses MongoDB as durable authority and Redis as a
  rebuildable execution scratchpad. Memory adapters are test-only.
- Long-term personal memory can be delayed, but identity, authorization, and
  durable operational state cannot be deferred entirely.
- The initial source layout is resolved by ADR-0009: one modular API app, with
  packages extracted only for real cross-app or cross-process reuse.

## V1 product hypothesis

The first request is: "Prepare an implementation plan for this Gatherle ticket
using the selected local repository as read-only project context." Vera will
delegate to the provider-neutral `development_planning@1` capability through
the configured specialist adapter, ask for approval before the shown context
crosses that adapter's declared data boundary, and persist one
versioned plan artifact idempotently.

This tests whether Vera is better than opening the specialist directly because
it selects the capability, scopes and approves context, preserves work through
failure, enforces resource limits, and provides one durable result and trace.
That advantage is a hypothesis to validate, not an accepted product fact.

## Open product questions

1. How proactive may Vera be without an explicit request?
2. Which action and disclosure classes must always require approval beyond V1?
3. What information may Vera retain automatically, and for how long?
4. What should Vera do when intent is ambiguous or no suitable capability is
   available?

## Open system questions

1. ~~Is the initial deployment local-only, cloud-hosted, or hybrid?~~
   Resolved by working assumption, 24 August 2026: local-only (Mac Mini).
2. ~~Must active work continue when the Mac Mini is offline or restarted?~~
   Resolved by working assumption, 24 August 2026: execution pauses while the
   machine is unavailable; durable work is recovered or safely classified on
   restart.
3. What availability and recovery guarantees are required for V1? — persistent
   mode is single-node and must recover or safely classify interrupted work;
   multi-node guarantees stay out of scope.
4. ~~How will a V1 client receive progress?~~ Resolved for V1: polling.
   Server-sent events, WebSockets, and notifications remain future options.
5. How are credentials brokered without exposing secrets to models?
6. What is the minimum capability protocol needed for progress, cancellation,
   retries, approvals, artifacts, and errors?
7. ~~What are the V1 semantics of steering work already running?~~ Resolved:
   live steering is deferred; V1 uses best-effort cancellation and a new task.
8. How will local and remote capabilities authenticate with Vera?
9. ~~Which information may V1 send to cloud Codex?~~ Resolved for the first
   journey: only the exact project/ticket context displayed for and granted
   explicit approval; never credentials or unrelated personal context.
10. What numerical cost, time, retry, invocation, and delegation-depth ceilings
    should V1 use within its required budget mechanism?
11. ~~Does Redis justify a second datastore?~~ Resolved for V1 by ADR-0010:
    yes, as a rebuildable TTL-bound projection; MongoDB remains authoritative.

## Implementation evidence and next increments

Work proceeds as production increments with explicit executable evidence. The
first increment completed the structured-model and local-provider boundaries.
The remaining entries are required capabilities, not permission to postpone
implementation. See
[ADR-0009](decisions/0009-implement-the-model-decision-boundary.md).

### Bounded assistant goals — implemented

Vera can now translate one explicit compound request into a validated sequence
of two or three enabled capabilities. The implementation proves separate
approval at each authority boundary, preservation of prior approvals and
invocations, typed and hash-verified artifact handoff, terminal goal projection,
CLI review of every step, and restart recovery between steps. It deliberately
does not add autonomous replanning, scheduled work, approval memory, or an
unbounded tool loop. See
[ADR-0021](decisions/0021-execute-bounded-goals-with-step-scoped-approvals-and-artifact-lineage.md).

### Structured model proposal — completed

The TypeScript API requests `ModelProposal` schema v1 from a real Ollama model,
rejects invalid and unauthorized shapes, validates exact proposal arguments,
and operates against a deterministic adapter in tests. Direct-response and
development-delegation conformance cases passed on 24 August 2026. The first
real-model run also proved why capability-specific argument schemas must be
part of structured generation: a generic object schema was safely rejected by
policy but allowed a malformed input shape.

### Durable lifecycle and storage adapters — implemented; core failure proof recorded

The code now persists one versioned task aggregate through a MongoDB port,
claims transitions with optimistic concurrency, stores exact approvals and
invocation identity before execution, emits ordered events, and projects a
newer-only TTL scratchpad to Redis. Deterministic tests prove idempotent
submission, one execution across concurrent approvals, conflict behavior,
failure persistence, and scratchpad rebuild. Real MongoDB 8.2 and Redis 8.10
verification then forced termination after the invocation identity was durable,
restarted Vera, resumed the same invocation, and recorded exactly one start and
one success. Deleting Redis state rebuilt version 5 from MongoDB, and an attempted
version-4 projection could not overwrite it.

### Capability boundary — implemented and owner-accepted

After explicit approval, the selected adapter for the registered,
provider-neutral `development_planning@1` capability receives only
schema-validated proposed arguments, the exact approved read-only context, and
a code-created invocation identity. It returns a schema-valid plan with
provider metadata; success or failure is durable. The implementation now
includes the late-bound adapter registry, default Codex adapter, generic
destination disclosure, artifact identity, wall-clock and byte ceilings,
recovery, and cancellation. On 25 August 2026 the owner reviewed and approved
one exact third-party Codex disclosure and accepted the resulting artifact,
completing the V1 evidence boundary.

### Isolated software implementation — implemented

The provider-neutral `software_change@1` capability now turns explicitly
approved project context and implementation intent into a durable review-only
patch artifact. The default `codex_cli` adapter writes inside a disposable,
workspace-sandboxed copy of the approved snapshot. Vera inspects that
filesystem and computes the Git patch, file operations, sizes, and hashes; it
does not trust model-authored effect metadata. Forbidden paths, credentials,
instruction files, binaries, symlinks, escapes, empty changes, and budget
violations fail closed.

The capability never mutates the registered repository. Applying, committing,
pushing, and opening a pull request remain separate effects rather than hidden
scope inside the change approval. The owner CLI exposes the artifact path as
`vera change` and constrains automatic approval to this exact capability. A
deterministic adapter proves orchestration and persistence without model cost;
Codex adapter tests prove isolated writes and Vera-derived patch evidence. See
[ADR-0017](decisions/0017-produce-software-changes-as-isolated-patch-artifacts.md).

### Controlled software-change application — implemented

An independently approved application resource now stages an exact
`software_change` artifact in a deterministic durable Git worktree. The
approval includes the immutable base commit, artifact and patch hashes, file
manifest, branch, workspace path, and staged effect. MongoDB stores the
application aggregate and project-scoped mutation lease; recovery inspects the
actual before/after/mixed state and fails closed on ambiguity. The registered
checkout, commits, pushes, and pull requests remain outside the effect. The
shared client and CLI expose create, inspect, wait, events, decision, and
cancellation paths. See
[ADR-0018](decisions/0018-apply-approved-software-changes-in-managed-git-worktrees.md).

### API source organization — implemented

The growing modular monolith now uses role-first nested modules: domain, ports,
application use cases, inbound/outbound adapters, and bootstrap composition.
Persistence technologies are adapters, but so are cloud/local model providers,
specialists, project-context readers, and controlled Git effects. Automated
architecture tests enforce inward dependency direction. See
[ADR-0019](decisions/0019-organize-the-api-as-an-inward-dependent-modular-monolith.md)
and `apps/api/README.md`.

### Local-model boundary — completed

The API calls Ollama through a narrow provider port and normalizes proposal,
usage, latency, timeout, unavailable-provider, and invalid-response outcomes.
Ollama response shapes do not enter Vera's domain contracts. Real conformance
and built-HTTP tests passed on 24 August 2026.

### Configurable model-provider boundary — implemented; keyed conformance remains

The model gateway now constructs Ollama, OpenAI, Gemini, or deterministic
adapters from an explicit startup registry. OpenAI uses the Responses API;
Gemini uses `generateContent`. Both request provider-native structured JSON,
normalize model, latency, usage, readiness, and failure metadata, and return an
untrusted candidate to the same authoritative Vera schema validation used for
Ollama. Unit conformance covers wire shape, schema conversion, credential
headers, refusal or timeout classification, model-access readiness, usage, and
the absence of upstream bodies from normalized errors.

`VERA_PROFILE` selects `.env.<profile>` with shell variables taking precedence
over the selected profile and the profile taking precedence over shared
`.env`. Unsafe or absent selected profiles fail startup. Provider switching is
process-wide and explicit; there is no automatic fallback across local and
cloud data boundaries. OpenAI and Gemini API keys are server-only transport
configuration. Real provider calls remain owner-run evidence because CI must
not use secrets or incur model cost.

Selecting a cloud brain authorizes the current owner message, minimal selected-
project identity, and bounded prior complete turns from the exact same project
scope to that provider. It does not disclose repository files, other
conversation scopes, or long-term memory. If the same cloud model is selected
as the `structured_model` specialist, the
existing exact context approval remains mandatory before project contents
cross the boundary.

### Conversation-aware orchestration — implemented

Conversation tasks freeze a hash-auditable bundle of prior complete owner/Vera
turn pairs in the same project scope, bounded by message and character limits.
Every terminal task records a pending Vera reply in its authoritative aggregate
before the worker idempotently appends that reply to conversation history. This
supports genuine follow-ups and crash recovery without treating history as
long-term memory. The shared client and `vera chat` CLI wait for projection
completion. ADR-0016 records the accepted semantics and disclosure change.

### Durable dispatch and client event consumption — implemented

Task-producing handlers now return after durable acceptance. An in-process
worker derives dispatchable work from MongoDB and uses expiring per-run MongoDB
leases for cross-worker exclusion; Redis remains a rebuildable projection. A
browser-neutral TypeScript client and owner CLI submit work, poll current run
state, inspect ordered events and approvals, decide approvals, cancel runs, and
retrieve artifacts. Deterministic HTTP evidence covers the asynchronous
project-to-artifact journey and concurrent lease exclusion. V1 retains polling;
measured client needs may justify a different progress transport later.

### Automated persistent acceptance gate — implemented

Required CI now attaches ephemeral MongoDB 8.2 and Redis 8 service containers
to the existing Linux quality job and runs the already-compiled persistent
journey. The gate uses deterministic inference, the owner-controlled
`structured_model` planning adapter, and the owner-controlled
`deterministic_change` adapter; it does not install Ollama, download model
weights, or contact Codex.

The journey covers the real CLI, HTTP server, worker, MongoDB, Redis, shared
client, and artifact path. It proves idempotent project, conversation, message,
and approval handling; direct response, approval, rejection, and cancellation
outcomes; concurrent task isolation; MongoDB lease exclusion; ordered events;
one typed plan or software-change artifact per invocation; Redis read repair;
survival of a forced process
termination at the approval boundary; and retrieval after a later graceful
restart. The isolated database and scratchpad keys are removed afterward.

The workflow remains one job, reuses one install and build, cancels superseded
runs, and has a five-minute hard limit. The persistent tier runs on the pull
request and is not repeated for its resulting `main` push, although it remains
manually triggerable. Static, unit, boundary, and build checks still run for
both events. This gate strengthens reproducible V1 evidence but does not replace
manual real-provider and specialist conformance; the owner separately completed
the required V1 Codex disclosure and artifact evaluation on 25 August 2026.

## Principal risks

| Risk | Consequence | Early mitigation |
|---|---|---|
| Flow becomes an overloaded concept | Persistent API and storage confusion | Use the explicit domain model before creating schemas. |
| Model output is treated as authority | Unsafe or incorrect side effects | Validate proposals and enforce deterministic policy. |
| Framework owns Vera's semantics | Vendor lock-in and difficult migrations | Keep domain entities and contracts framework-independent. |
| Redis becomes the only active-state store | Lost or incoherent work after failures | Define durability first and use an authoritative store. |
| MongoDB and Redis diverge during a partial failure | Stale working state drives incorrect execution | Make MongoDB authoritative, update Redis only as a rebuildable projection, and test the failure window. |
| Flexible MongoDB documents drift silently | Recovery and migrations become unpredictable | Enforce application schemas, collection validation, document versions, and indexes. |
| Credentials enter prompts or logs | Security compromise | Use scoped handles and a credential broker boundary. |
| Documentation becomes generated clutter | Builders receive noisy or contradictory context | Create only purposeful artifacts and assign authority clearly. |
| Shared monorepo packages become a grab bag | Clients gain server-only dependencies or secrets | Define runtime and trust boundaries before package layout. |
| Multi-agent complexity arrives early | Non-determinism without user value | Prove one bounded delegation path first. |
| Model or capability loop consumes unbounded resources | Unexpected cost, unavailable service, or uncontrolled delegation | Enforce finite run ceilings and forbid recursive delegation in V1; require inherited child limits before later enabling child tasks. |
| Memory stores unsupported inference as fact | Loss of user trust | Record provenance, confidence, scope, and deletion rules. |

## Explicit non-decisions

The project has not selected:

- an agent or graph framework;
- a durable workflow engine;
- an ORM;
- a post-V1 streaming or notification protocol;
- an authentication provider;
- a mobile or web framework;
- a monorepo task runner;
- a model provider as Vera's permanent default.

Fastify is selected for the API, Zod for runtime schemas, and the initial source
layout is `apps/api` with `packages/*` reserved for genuine sharing. These are
accepted in ADR-0009.

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
