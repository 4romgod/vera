# Vera System Architecture

**Status:** Accepted (logical architecture, component responsibilities,
request lifecycle, architectural invariants, initial modular API shape, and V1
operational storage); general progress transport and deployment topology remain open
**Version:** 1.2
**Last updated:** 26 August 2026
**Accepted:** 24 August 2026 (owner) — post-V1 progress transport and deployment
topology are deferred; V1 uses HTTP polling. The initial Fastify/Zod modular API
is accepted by ADR-0009. MongoDB operational truth and the Redis scratchpad are
accepted by ADR-0010. The V1 owner perimeter is accepted by ADR-0014 and the
startup-selected model-provider registry by ADR-0015. Conversation context and
reply projection are accepted by ADR-0016.
Software-change artifacts, controlled application, the enforced API module
map, and the declarative capability runtime with project-independent web
research are accepted by ADRs 0017–0020.
Bounded goal execution and typed artifact lineage are accepted by ADR-0021.
Provider-neutral integration actions and Vera-owned personal tasks are accepted
by ADR-0022. Durable reminders and the Vera-owned notification inbox are
accepted by ADR-0023; task progress continues to use polling.
Evidence-adaptive bounded goals are accepted by ADR-0024. Explicit governed
memory and its provider boundary are accepted by ADR-0025. The universal Expo
React Native frontend is accepted by ADR-0026, its private physical-device
ingress through Tailscale Serve is accepted by ADR-0027, and reviewed device
voice input and output are accepted by ADR-0028.

## Purpose

This document describes Vera's accepted logical architecture: the major
components, their responsibilities, the boundaries between them, and the
lifecycle of a request. It deliberately separates stable system semantics from
replaceable products and frameworks.

The architecture is evolutionary. V1 should implement the smallest credible
subset while preserving the boundaries required for future clients,
capabilities, local and cloud models, memory, and concurrent work.

## Architectural thesis

Vera is a durable, policy-controlled orchestration system that borrows
reasoning from models and delegates bounded work to capabilities.

The orchestrator is not itself a brain. It is application code that:

1. receives intent;
2. constructs relevant context;
3. asks a model or deterministic component for a structured proposal;
4. validates that proposal;
5. applies policy and approval rules;
6. coordinates execution;
7. records events and results;
8. keeps the user in control.

## System context

```mermaid
flowchart LR
    U["Owner"] -->|"text, voice, files, commands"| C["Vera clients"]
    C -->|"versioned API"| V["Vera"]

    V -->|"reasoning requests"| MP["Model providers"]
    V -->|"bounded invocation"| DEV["Development workflow"]
    V -->|"bounded invocation"| AWS["Cloud operations workflow"]
    V -->|"bounded invocation"| RES["Research workflow"]
    V -->|"tool calls"| SVC["Services and tools"]
    V -->|"local execution"| MACH["Authorized machines"]

    MP --> OLL["Ollama-hosted local models"]
    MP --> CLOUD["Cloud models"]

    DEV -. "future/illustrative" .-> CODEX["Codex or another coding specialist"]
```

The owner interacts with Vera. Provider and capability selection is normally an
internal responsibility, although advanced clients may expose controls and
explanations.

## Logical architecture

```mermaid
flowchart TB
    subgraph Experience["Experience plane"]
        CLI["CLI / Postman"]
        FRONTEND["Universal frontend<br/>(web, iOS, Android)"]
        VOICE["Device speech services<br/>(recognition and playback)"]
    end

    subgraph Boundary["External boundary"]
        API["API and progress interface"]
        ID["Identity and request validation"]
    end

    subgraph Kernel["Vera kernel"]
        CONV["Conversation service"]
        TASK["Task and run service"]
        ORCH["Orchestration engine"]
        POLICY["Policy and approval engine"]
        REG["Capability registry"]
        CONTEXT["Context assembler"]
    end

    subgraph Adapters["Provider and capability adapters"]
        MODEL["Model gateway"]
        CAP["Capability gateway"]
        CREDS["Credential broker"]
    end

    subgraph State["State and evidence"]
        OPS["Durable operational state"]
        WORK["Rebuildable active working set"]
        EVENTS["Event journal and projections"]
        MEMORY["Governed long-term memory"]
        ART["Artifact metadata and content"]
        OBS["Logs, metrics, traces"]
    end

    CLI --> API
    FRONTEND --> API
    VOICE --> FRONTEND
    API --> ID --> CONV
    CONV --> TASK --> ORCH
    ORCH --> CONTEXT
    ORCH --> POLICY
    ORCH --> REG
    CONTEXT --> MODEL
    REG --> CAP
    POLICY --> CAP
    CAP --> CREDS

    CONV --> OPS
    TASK --> OPS
    ORCH --> OPS
    ORCH <--> WORK
    OPS -. "rebuild" .-> WORK
    ORCH --> EVENTS
    CONTEXT --> WORK
    CONTEXT --> MEMORY
    CAP --> ART
    ORCH --> OBS
    MODEL --> OBS
    CAP --> OBS
```

These are logical responsibilities, not necessarily separate processes in V1.
A modular monolith may implement several of them in one deployable service while
preserving internal boundaries.

## Component responsibilities

### API and progress interface

- authenticate the initiating principal;
- validate versioned request payloads;
- apply idempotency and request-size rules;
- create or continue conversations and tasks;
- expose current projections, events, approvals, and artifacts;
- expose progress without making a network connection the source of truth;
- contain minimal orchestration logic.

### Conversation service

- create and retrieve conversations;
- append immutable messages;
- associate messages with tasks and steering actions;
- produce client-facing summaries;
- prevent unrelated context from being included automatically.

### Task and run service

- create durable tasks and execution attempts;
- validate lifecycle transitions;
- coordinate retries without rewriting earlier attempts;
- expose current state derived from recorded transitions;
- distinguish task outcome from run outcome.

### Orchestration engine

- choose the next permitted step;
- request structured proposals where reasoning is useful;
- execute deterministic transitions;
- invoke policies, approvals, models, and capabilities;
- manage timeouts, retries, cancellation, and recovery;
- remain independent of one model provider or agent framework.

### Policy and approval engine

- determine whether a proposed operation is allowed, denied, or requires
  approval;
- evaluate principal, capability, data sensitivity, environment, and effect;
- enforce task and run budgets for cost, time, steps, retries, invocations, and
  delegation depth;
- issue narrowly scoped approval requests;
- ensure approval cannot be broadened by a model or capability.

### Capability registry

- declare stable capability identity, proposal schema, artifact, and authority;
- expose enabled and disabled capabilities without exposing credentials;
- supply only enabled contracts to model routing;
- resolve a frozen capability destination to its runtime adapter; and
- keep capability-specific parsing and validation outside the shared task
  lifecycle.

### Context assembler

- select relevant messages, task state, events, memory, project knowledge,
  policy, and capability descriptions;
- enforce token, sensitivity, provenance, and provider constraints;
- produce a disposable model-context projection;
- avoid sending the entire conversation or database by default.

### Active working-set service

- maintain one isolated, versioned execution scratchpad per active run;
- store tentative plans, current-step data, intermediate results, and other
  disposable coordination state;
- apply explicit retention and expiration without using TTL as execution truth;
- require consequential decisions and effect identities to be durable before
  they are acted upon; and
- rebuild the working set from durable state after loss or classify the run for
  review when safe reconstruction is impossible.

### Model gateway

- provide a Vera-facing interface for structured reasoning and response
  generation;
- translate provider-specific request and response shapes;
- validate outputs and expose usage, latency, and failure metadata;
- select Ollama, OpenAI, Gemini, or deterministic implementations through an
  explicit startup registry and profile;
- prohibit silent fallback across owner-controlled and third-party boundaries;
- make provider capabilities explicit rather than pretending all models are
  identical.

Provider-native structured-output support is an adapter concern. In
particular, the Ollama adapter derives a compatible grammar schema by removing
unsupported validation keywords. If Ollama rejects that grammar, the adapter
may retry the same request against the same Ollama model in JSON mode; it must
not select another provider. In every case, the unmodified Vera Zod schema is
the authoritative post-generation validator, so unsupported provider grammar
features never become relaxed domain contracts. The schema travels through the
model-provider port and is not duplicated as prompt prose: the prompt describes
selection policy and capability semantics, while the separate schema defines
the machine-readable output contract. Ollama reasoning mode is explicit
configuration because model families differ: the adapter forwards the selected
boolean or reasoning level, consumes only final structured content, and
discards the provider's separate reasoning trace.

The canonical distinction between a model provider such as Ollama and a Vera
capability is defined in the [Capability Model](capability-model.md#model-providers).

### Capability gateway

- invoke local functions, remote services, tools, agents, or workflows through
  a common lifecycle;
- enforce declared inputs and permissions;
- normalize progress, completion, failure, timeout, and cancellation;
- keep capability implementations out of Vera's private storage schema.

The gateway may delegate one closed action to an integration-action executor.
That port describes the logical integration, destination, readiness, exact
action authority, idempotent invocation identity, and normalized result. It
does not expose a vendor SDK to the orchestration lifecycle. A local Vera store
and a future remote service can therefore implement the same capability
contract without making the capability or model proposal vendor-specific.

### Credential broker

- resolve opaque credential references only after authorization;
- provide the narrowest credential suitable for an invocation;
- prevent raw credentials from entering prompts, ordinary events, or logs;
- record credential use without recording secret material.

### State and evidence services

- store authoritative conversations, tasks, runs, steps, approvals, and
  invocation records durably;
- record immutable events and build query-friendly projections;
- store artifact metadata and content through appropriate backends;
- expose long-term memory through its own governance rules;
- correlate logs, metrics, traces, and domain identifiers.

## Request lifecycle

```mermaid
sequenceDiagram
    actor Owner
    participant Client
    participant API
    participant Kernel as Vera kernel
    participant Store as Durable state
    participant Working as Active working set
    participant Model as Model gateway
    participant Policy
    participant Capability

    Owner->>Client: Express intent
    Client->>API: Add message / create task
    API->>Kernel: Validated principal and request
    Kernel->>Store: Create message, task, and run
    Kernel->>Store: Record run-started event
    Kernel->>Working: Create rebuildable run scratchpad
    Kernel->>Model: Bounded context + proposal schema
    Model-->>Kernel: Structured proposal
    Kernel->>Working: Cache tentative proposal
    Kernel->>Kernel: Validate proposal
    Kernel->>Policy: Authorize proposed next action

    alt denied
        Policy-->>Kernel: Deny with reason
        Kernel->>Store: Record denial and safe outcome
    else approval required
        Policy-->>Kernel: Approval required
        Kernel->>Store: Persist approval request and waiting state
        Owner->>Client: Approve or deny
        Client->>API: Approval decision
        API->>Kernel: Validated decision
    else allowed
        Policy-->>Kernel: Allow with bounded authority
    end

    opt allowed after policy or approval
        Kernel->>Store: Persist accepted decision and invocation identity
        Kernel->>Working: Project current durable state
        Kernel->>Capability: Versioned invocation
        Capability-->>Kernel: Progress events
        Kernel->>Store: Record progress
        Kernel->>Working: Project temporary progress
        Capability-->>Kernel: Result / artifact / failure
        Kernel->>Store: Record outcome and final transition
    end

    API-->>Client: Current state and ordered events
    Client-->>Owner: Result and explanation
```

The client connection or active working-set store may disappear at any point.
Authoritative execution state remains in durable storage. The scratchpad can be
reconstructed after reconnection or restart; accepted work never depends only
on its survival.

## Bounded goal execution

Vera has two additive, versioned goal modes. A fixed goal is appropriate when
the complete safe composition is known before work starts. An adaptive goal is
appropriate when the next action depends on evidence not yet available.

### Fixed goal

```mermaid
flowchart LR
    I["One owner goal"] --> P["Validated 2–3 step plan"]
    P --> A1["Approval: step 1"]
    A1 --> C1["Capability 1"]
    C1 --> R1["Typed artifact + hash"]
    R1 --> A2["Approval: step 2 + exact input reference"]
    A2 --> C2["Capability 2"]
    C2 --> R2["Typed artifact + lineage"]
    R2 --> G["Durable goal result"]
```

The model proposes this small graph; it does not control its execution. Vera
code admits only enabled capability versions, backward-only dependencies, and
declared artifact compatibility. The lifecycle advances one step at a time and
freezes a new approval whenever destination, authority, context, or artifact
disclosure changes. This is the implemented substrate for assistant-level
outcomes without adopting a provider-owned or unbounded agent loop.

A goal remains one run while it is short, sequential, and serves one outcome.
Independent delegated work will use child tasks so it can carry its own
lifecycle, budget, cancellation, and owner-visible result.

### Evidence-adaptive goal

```mermaid
sequenceDiagram
    actor Owner
    participant Kernel as "Vera kernel"
    participant Model as "Owner-controlled brain"
    participant Store as "Durable state and artifacts"
    participant Capability

    Owner->>Kernel: Evidence-dependent outcome
    Kernel->>Model: Intent + enabled contracts + first-step schema
    Model-->>Kernel: Objective + outcome requirements + one first step
    Kernel->>Kernel: Validate capability, arguments, identity, and budget
    Kernel-->>Owner: Exact step approval
    Owner->>Kernel: Approve
    Kernel->>Capability: Approved invocation
    Capability-->>Kernel: Typed artifact
    Kernel->>Store: Persist artifact + completed step
    Kernel->>Store: Reload and verify observation integrity
    Kernel->>Model: Minimized untrusted evidence + next-step schema
    Model-->>Kernel: Complete with requirement resolutions or propose one next step
    alt complete
        Kernel->>Kernel: Match every satisfied outcome to its capability observation
        Kernel->>Store: Persist verified outcome ledger and success
    else continue
        Kernel->>Kernel: Validate evidence, capability, arguments, identity, and remaining budget
        Kernel->>Store: Persist continuation before action
        Kernel-->>Owner: New exact approval
    end
```

Adaptive execution does not expose an open model tool loop. Vera supplies the
next step identity, presents only enabled capability schemas, validates every
evidence reference and artifact hash, and stops after at most three capability
steps and four model calls. Evidence that informed a decision is recorded
separately from artifacts passed as invocation inputs. Every effect receives a
fresh exact approval.

The kernel also reconciles the initial model plan with conservative explicit
outcome signals owned by each capability declaration. A plainly requested
action omitted by the model becomes a durable requirement, not an automatic
invocation. Continuation schemas enumerate exact step and requirement IDs so
provider formatting cannot invent control-plane identity.

Capability artifact contents initially cross only an `owner_controlled`
orchestration-model boundary. The adaptive proposal is absent from third-party
brain schemas; recovery with a third-party brain fails before artifact
disclosure. This rule is provider-neutral and therefore permits another local
or owner-controlled model adapter without coupling the domain to Ollama. See
[ADR-0024](decisions/0024-adapt-bounded-goals-from-validated-capability-evidence.md).

## Concurrent work

```mermaid
flowchart TD
    V["Vera kernel"] --> TA["Task A: develop feature"]
    V --> TB["Task B: inspect cloud health"]
    V --> TC["Task C: personal conversation"]

    TA --> RA["Run A1"] --> CA["Development capability"]
    TB --> RB["Run B1"] --> CB["Cloud capability"]
    TC --> RC["Run C1"] --> CC["Direct model response"]

    RA --> EA["Events / artifacts A"]
    RB --> EB["Events / artifacts B"]
    RC --> EC["Events / artifacts C"]
```

Isolation is logical and enforceable, not merely a naming convention. Context,
authority, cancellation, errors, and artifacts are scoped to the relevant work.

## Current implemented slice

The production slice now wraps the permanent model decision boundary in a
durable task lifecycle inside `apps/api`:

```mermaid
sequenceDiagram
    actor Owner
    participant API as "Fastify API"
    participant Life as "Task lifecycle"
    participant Worker as "Durable task worker"
    participant History as "Conversation history"
    participant Mongo as "MongoDB authority"
    participant Lease as "MongoDB run leases"
    participant Redis as "Redis scratchpad"
    participant Model as "Model-provider registry"
    participant Policy as "Schema, registry, and approval policy"
    participant Source as "Optional registered project source"
    participant Capability as "Generic capability runtime"
    participant Artifact as "Versioned artifact store"

    Owner->>API: Register project and create conversation
    Owner->>API: POST conversation message + projectId
    API->>Life: Validated owner request
    Life->>History: Select prior complete same-scope turns
    History-->>Life: Bounded messages + hash manifest
    Life->>Mongo: Create task/run + frozen conversation context
    Life->>Redis: Project rebuildable working state
    Life-->>API: Durable task in deciding state
    API-->>Owner: 202 + task/run identifiers
    API->>Worker: Wake poller
    Worker->>Mongo: Find dispatchable runs
    Worker->>Lease: Claim run with expiring token
    Worker->>Life: Progress claimed task
    Life->>Model: Current message + bounded history + proposal schema
    Model-->>Life: Provider-neutral candidate + usage
    Life->>Policy: Validate proposal and capability arguments
    opt Capability requires project context
        Life->>Source: Select bounded tracked context
        Source-->>Life: Hash-verified manifest and contents
    end
    Life->>Mongo: Record decision, event, and exact approval request
    Life->>Redis: Project awaiting-approval state
    Worker->>Lease: Release claim
    Owner->>API: Poll run and inspect exact approval
    Owner->>API: Approve exact action
    Life->>Mongo: Persist approval decision
    Life-->>API: Durable approved state
    API-->>Owner: 202 accepted
    API->>Worker: Wake poller
    Worker->>Mongo: Rediscover approved run
    Worker->>Lease: Claim run with expiring token
    Worker->>Life: Progress claimed task
    Life->>Mongo: Persist invocation identity
    Life->>Capability: Exact arguments + optional context + bounded authority
    Capability-->>Life: Typed artifact draft + provider metadata
    Life->>Artifact: Idempotent create by invocation ID
    Life->>Mongo: Record result + terminal events + pending Vera reply
    Life->>History: Idempotently append Vera reply by task
    Life->>Mongo: Mark reply projection complete
    Life->>Redis: Project terminal state
    Worker->>Lease: Release claim
    Owner->>API: Poll run and retrieve artifact
    opt Redis state is missing
        Life->>Mongo: Read authoritative aggregate
        Life->>Redis: Rebuild newer projection
    end
```

The local source adapter performs context selection without a model or network
call. Exact request anchors, token-boundary path matches, and fixed-string
content matches establish relevance. A resolved exact anchor suppresses broad
prose-token expansion; an unmatched request receives only repository-root
evidence rather than arbitrary source files. Implementation and verification
evidence outrank documentation, and implementation requests retain separate
documentation file and byte ceilings even when documentation is one requested
deliverable. Tracked repository-root formatter configuration is included as
verification evidence. Only the selected, hashed files cross the later
approval boundary; local discovery results and unselected repository contents
do not.

The MongoDB document is the atomic V1 task aggregate: current task/run state and
the event proving each transition are replaced together under optimistic
version control. Redis receives only a schema-versioned, expiring projection;
projection failure cannot roll back or erase durable truth. Exact mechanics and
rationale are in [ADR-0010](decisions/0010-use-mongodb-for-operational-truth-and-redis-for-scratchpads.md).

Task-producing and approval `POST` handlers return after the requested
transition is durable. An in-process worker polls dispatchable MongoDB state,
claims an expiring per-run MongoDB lease, and advances the same lifecycle
service used by deterministic tests. Work is therefore independent of the
client connection and rediscoverable after restart. Redis is not a queue and an
untracked promise is never the execution contract. See
[ADR-0013](decisions/0013-dispatch-durable-work-with-mongodb-leases.md).

The current worker shares the API process only as an initial deployment
topology. Its port boundaries permit a separate worker process later. Leases
provide cross-process exclusion; optimistic aggregate transitions and
idempotent invocation/artifact identities provide recovery safety.

This slice now includes a browser-neutral TypeScript client used by an owner
CLI and universal Expo React Native frontend, generic project and conversation
resources, governed owner memory, selected
read-only Git context, bounded same-scope multi-turn context, recoverable Vera
reply projection, exact disclosure approval, a provider-neutral specialist
port with a late-bound adapter registry, the default Codex adapter, artifact
identity, flat resource ceilings, and best-effort
cancellation. Memory retention and every memory mutation require exact owner
approval; bounded, integrity-checked memory context is disclosed only to an
owner-controlled model provider. The model-backed planner remains an explicit
provider-neutral adapter. Ollama, OpenAI, and Gemini implement the same
structured-generation port; provider-specific schemas, credentials, readiness,
and errors stay behind their adapters. Deterministic tests cover interrupted
invocation, cancellation recovery, conversation-scope isolation, and
reply-projection recovery; a compiled persistent-mode journey verifies
artifact, dialogue, and memory survival across process restart plus Redis
projection reconstruction. The owner accepted the exact real-cloud-Codex
disclosure and resulting artifact on 25 August 2026, completing the V1 evidence
boundary.

Live model qualification remains outside required CI. Direct conformance can
repeat the provider-neutral decision, planning, and adaptive-continuation cases
and reports aggregate reliability, latency, and token use. A separate compiled
journey then verifies the selected orchestration model through the real HTTP,
worker, MongoDB, Redis, approval, artifact, conversation, and adaptive-goal
boundaries while keeping specialist adapters deterministic. Qualification
summaries may expose final outputs and normalized usage metadata but never the
provider's private reasoning trace.

The same lifecycle now also implements `software_change@1`. Its Codex adapter
uses a workspace-write sandbox over a disposable approved snapshot, while the
registered repository remains untouched. Vera derives an authoritative Git
patch and file hashes from the snapshot and stores a review-only
`software_change` artifact. Application, commit, push, and pull-request effects
remain outside this capability. The deterministic adapter drives the compiled
persistent journey without downloads or third-party calls. See
[ADR-0017](decisions/0017-produce-software-changes-as-isolated-patch-artifacts.md).

The capability gateway now uses one declarative runtime for planning, software
change, and web research. The registry is the shared source for catalog
inspection, model-visible contracts, readiness, approval authority, destination
resolution, and execution. `web_research@1` proves that task execution is not
coupled to coding or projects: no project context is assembled or persisted for
that invocation. Its exact owner question, third-party provider destination,
public-network authority, and four-search ceiling are frozen before execution;
the result is a durable source-backed `research_report` artifact.

```mermaid
flowchart TD
    DECL["Capability declarations"] --> CAT["GET /v1/capabilities"]
    DECL --> ENABLED["Enabled runtime references"]
    ENABLED --> SCHEMA["Model proposal schema"]
    ENABLED --> READY["Readiness checks"]
    SCHEMA --> APPROVAL["Frozen approval"]
    APPROVAL --> RESOLVE["Resolve exact destination"]
    RESOLVE --> PLAN["development_planning adapter"]
    RESOLVE --> CHANGE["software_change adapter"]
    RESOLVE --> RESEARCH["web_research adapter"]
    RESOLVE --> PERSONAL["personal_task integration action"]
    RESOLVE --> REMINDER["personal_reminder integration action"]
    PLAN --> ARTIFACT["Versioned artifacts"]
    CHANGE --> ARTIFACT
    RESEARCH --> ARTIFACT
    PERSONAL --> ARTIFACT
    REMINDER --> ARTIFACT
```

The initial live research adapter uses OpenAI Responses web search, is selected
independently from the orchestration model, and is disabled by default. There is
no automatic fallback. See
[ADR-0020](decisions/0020-use-a-declarative-capability-runtime-and-approval-gated-web-research.md).

`personal_task_management@1` is the first assistant-oriented integration
capability. It routes `create`, `list`, `complete`, and `reopen` through the
provider-neutral integration-action port to Vera's durable owner-scoped task
store. Authority is calculated from the validated action: listing discloses
personal-task data without a side effect, while mutations additionally disclose
`personal_data_write`. The invocation identity makes creation idempotent, and a
recovered older mutation cannot overwrite a newer task state. Each invocation
produces a `personal_task_result` artifact while the task remains a separately
addressable owner resource. See
[ADR-0022](decisions/0022-introduce-provider-neutral-integration-actions-with-vera-owned-personal-tasks.md).

`personal_reminder_management@1` adds time as an external trigger without
adding an unbounded agent loop. The approved action writes a one-shot reminder
to MongoDB. A scheduler claims only due reminders with expiring tokens; delivery
atomically transitions the reminder and embeds one durable inbox notification.
The API exposes the inbox through cursor-based reads and a resumable SSE
projection. Redis and live HTTP connections are never reminder authority.

```mermaid
flowchart LR
    ACTION["Approved reminder action"] --> STORE["MongoDB reminder"]
    CLOCK["Scheduler clock"] --> CLAIM["Expiring due claim"]
    STORE --> CLAIM
    CLAIM --> DELIVERY["Notification delivery port"]
    DELIVERY --> ATOMIC["Atomic delivered state + inbox notification"]
    ATOMIC --> PAGE["Cursor-based inbox"]
    ATOMIC --> SSE["SSE projection"]
```

See
[ADR-0023](decisions/0023-deliver-durable-reminders-through-a-vera-owned-notification-inbox.md).

The same worker lifecycle now supports adaptive goals. After a step artifact is
durable, the run returns to `deciding`; the worker can therefore disappear at
the observation boundary without losing the completed effect or inventing the
next one. Recovery reloads and validates all completed artifacts before the
owner-controlled brain proposes completion or one next step. The continuation
is stored before any new approval is presented, so a restart cannot turn a
tentative model response into an unrecorded action. This path reuses the generic
capability runtime rather than naming research, reminders, or coding in the
lifecycle.

```mermaid
stateDiagram-v2
    [*] --> deciding
    deciding --> awaiting_approval: first or continued step validated
    awaiting_approval --> executing: exact approval granted
    executing --> deciding: observation durably recorded
    deciding --> succeeded: evidence supports completion
    deciding --> failed: invalid evidence, proposal, provider, or budget
    awaiting_approval --> rejected: owner rejects
    executing --> failed: capability or integrity failure
```

See
[ADR-0024](decisions/0024-adapt-bounded-goals-from-validated-capability-evidence.md).

Artifact application is a separate durable lifecycle rather than hidden inside
that capability. The owner approves an exact artifact hash, immutable base
commit, patch hash, file manifest, deterministic branch, workspace path, and
staged effect. A change-application worker holds a project-scoped MongoDB lease
while the `local_git_worktree` adapter materializes and verifies the effect. The
registered checkout remains untouched, and commit/publication authority remains
absent. Recovery inspects before/after/mixed filesystem state; it never infers
completion from an interrupted process claim. See
[ADR-0018](decisions/0018-apply-approved-software-changes-in-managed-git-worktrees.md).

```mermaid
flowchart LR
    ART["Durable software_change artifact"] --> CREATE["Create application"]
    CREATE --> DISCLOSE["Exact effect disclosure"]
    DISCLOSE --> APPROVE{"Owner decision"}
    APPROVE -->|"reject"| REJECTED["Rejected"]
    APPROVE -->|"approve"| LEASE["Project mutation lease"]
    LEASE --> WT["Deterministic managed Git worktree"]
    WT --> VERIFY{"Before / after / mixed verification"}
    VERIFY -->|"exact after + index"| SUCCESS["Succeeded: staged"]
    VERIFY -->|"exact before + cancellation"| CANCELLED["Cancelled and removed"]
    VERIFY -->|"mixed or unexpected"| REVIEW["Review required"]
```

Approval freezes the complete specialist destination. Execution and recovery
resolve that persisted descriptor rather than the currently selected adapter;
missing or changed adapter configuration fails closed instead of redirecting
approved context.

The app rejects non-loopback bind configuration. V1 trusts the authenticated
Mac Mini account, SSH session, and optionally the owner's private tailnet as its
deployment perimeter, maps admitted requests to `owner_v1`, and requires
application authentication before shared or multi-user exposure under
[ADR-0014](decisions/0014-use-the-host-session-as-the-v1-owner-boundary.md) and
[ADR-0027](decisions/0027-use-tailscale-serve-for-private-physical-device-access.md).
Tailscale Serve terminates HTTPS and proxies to the unchanged loopback listener;
Funnel and direct LAN/Tailscale binding remain forbidden.
For physical-browser development, the same Serve origin maps `/` to loopback
Expo web and `/api` to the API, avoiding a remote CORS exception.
The API admits browser cross-origin reads only from loopback HTTP(S) origins so
the Expo web development server can use a separate port without making CORS an
authentication substitute or exposing Vera to the LAN.

Voice remains inside the experience plane under
[ADR-0028](decisions/0028-treat-device-voice-as-a-reviewed-experience-adapter.md).
The device speech service turns deliberately captured audio into an editable
composer draft; only an explicit Send enters the existing conversation API.
The API receives text, never microphone audio. A voice-originated terminal
reply is played only after its durable Vera message has been projected, and
playback or run polling can be interrupted without creating a second execution
path.

Health is process liveness.
Readiness verifies provider connectivity, configured-model availability,
MongoDB, Redis, worker lease access, lifecycle recovery, and every enabled
capability runtime without running orchestration inference or a web search.

## Proposed API resource shape

The initial conversation proposed a single endpoint with an optional `flow_id`,
then evolved toward flow-oriented resources. The refined domain model separates
the user-visible conversation from executable work.

The implemented V1 lifecycle paths are:

```text
GET    /v1/capabilities
POST   /v1/tasks                         # requires Idempotency-Key
POST   /v1/projects                      # requires Idempotency-Key
GET    /v1/projects
GET    /v1/projects/{project_id}
POST   /v1/conversations                 # requires Idempotency-Key
GET    /v1/conversations
GET    /v1/conversations/{conversation_id}
POST   /v1/conversations/{conversation_id}/messages
GET    /v1/tasks/{task_id}
GET    /v1/runs/{run_id}
GET    /v1/runs/{run_id}/events
POST   /v1/approvals/{approval_id}/decision
POST   /v1/runs/{run_id}/cancellation
GET    /v1/artifacts/{artifact_id}
POST   /v1/artifacts/{artifact_id}/applications   # requires Idempotency-Key
GET    /v1/change-applications/{application_id}
GET    /v1/change-applications/{application_id}/events
POST   /v1/change-applications/{application_id}/decision
POST   /v1/change-applications/{application_id}/cancellation
POST   /v1/model-decisions               # low-level decision diagnostic
GET    /health
GET    /ready
```

The broader post-V1 target shape remains illustrative:

```text
GET    /v1/tasks
GET    /v1/tasks/{task_id}

GET    /v1/runs/{run_id}
GET    /v1/runs/{run_id}/events
POST   /v1/tasks/{task_id}/retry

GET    /v1/approvals
POST   /v1/approvals/{approval_id}/decision

GET    /v1/capabilities
GET    /v1/health
```

Clients should create new conversations or continue existing ones through
ordinary UI actions. They retain opaque identifiers in the background; the
owner should not have to speak or type IDs.

The shared TypeScript client wraps these resources without owning
orchestration semantics. The owner CLI uses that client and renders the exact
approval disclosure before interactive or explicitly requested approval. Its
`chat` path creates or continues a conversation, waits for any approval and the
durable Vera reply, and returns the reply with its task identity.
The `plan` and `change` commands constrain auto-approval to their exact
capability, then retrieve the resulting artifact.

For V1, accepting a task-producing message returns `202 Accepted` with the
conversation, task, and run identifiers. Clients poll run, event, approval, and
artifact resources. Live steering is deferred; changed intent creates a new
task after best-effort cancellation where necessary. The implemented paths and
schemas are owned by the [HTTP API](api.md).

## Initial deployment hypothesis

```mermaid
flowchart LR
    subgraph PersonalNetwork["Owner-controlled environment"]
        CLIENT["Postman / CLI"]
        VERA["Vera service"]
        DB["Durable database"]
        WORKING["Active working-set store"]
        OLLAMA["Ollama"]
        LOCAL["Local capabilities"]
    end

    subgraph External["External trust domains"]
        MODELS["Cloud model APIs"]
        SERVICES["Cloud services and remote workflows"]
    end

    CLIENT --> VERA
    VERA --> DB
    VERA --> WORKING
    DB -. "rebuild" .-> WORKING
    VERA --> OLLAMA
    VERA --> LOCAL
    VERA -->|"policy-controlled data"| MODELS
    VERA -->|"scoped credentials and inputs"| SERVICES
```

Running on the Mac Mini is a working assumption, not an accepted deployment
decision. The architecture must state what happens when that machine sleeps,
restarts, loses connectivity, or becomes unavailable.

## Architectural invariants

- No model writes directly to Vera's authoritative store.
- No client owns orchestration semantics.
- No capability receives unrestricted credentials by default.
- Every side effect is associated with a principal, task, run, and invocation.
- Every persisted or external contract has an explicit versioning strategy.
- Every run has finite resource and delegation ceilings enforced outside models.
- Provider-specific data does not become the core domain model.
- A process restart does not silently erase accepted work.
- Progress transport is not the source of execution truth.
- Completion is supported by evidence, not model confidence.

## Evolution path

### V1

- one owner;
- one API client;
- one model gateway with a deterministic fake and at least one real provider;
- one real specialist capability;
- one rebuildable active execution scratchpad per run;
- durable tasks, runs, events, and approvals;
- basic progress, cancellation, recovery, and artifact handling.

### Later

- multiple clients including mobile, web, voice, and notifications;
- richer capability discovery and routing;
- multiple execution environments;
- governed long-term memory;
- schedules and proactive work;
- collaboration and carefully designed multi-user authority;
- stronger availability and distributed execution.

## Decisions and unresolved questions

Related decisions are indexed in [Architecture Decisions](decisions/README.md).
Open questions and required implementation evidence remain in the
[Discovery Record](discovery-record.md). V1 uses HTTP polling; persistence,
later streaming transport, deployment, and the remaining resource API shapes
are not accepted by this document. Fastify, Zod, the modular API layout, and the
model decision endpoint are accepted by ADR-0009. The nested module map and
enforced inward dependency direction are accepted by
[ADR-0019](decisions/0019-organize-the-api-as-an-inward-dependent-modular-monolith.md).
