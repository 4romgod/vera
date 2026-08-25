# Vera System Architecture

**Status:** Accepted (logical architecture, component responsibilities,
request lifecycle, architectural invariants, initial modular API shape, and V1
operational storage); post-V1 progress transport and deployment topology remain open
**Version:** 0.9
**Last updated:** 25 August 2026
**Accepted:** 24 August 2026 (owner) — post-V1 progress transport and deployment
topology are deferred; V1 uses HTTP polling. The initial Fastify/Zod modular API
is accepted by ADR-0009. MongoDB operational truth and the Redis scratchpad are
accepted by ADR-0010. The V1 owner perimeter is accepted by ADR-0014 and the
startup-selected model-provider registry by ADR-0015. Conversation context and
reply projection are accepted by ADR-0016.
Software-change artifacts, controlled application, and the enforced API module
map are accepted by ADRs 0017–0019.

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
        WEB["Future web client"]
        MOBILE["Future mobile / voice client"]
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
        MEMORY["Long-term memory service"]
        ART["Artifact metadata and content"]
        OBS["Logs, metrics, traces"]
    end

    CLI --> API
    WEB --> API
    MOBILE --> API
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

- describe available capabilities and versions;
- expose selection metadata without exposing credentials;
- record health, availability, permissions, and execution mode;
- resolve a capability declaration to an invocation adapter.

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

The canonical distinction between a model provider such as Ollama and a Vera
capability is defined in the [Capability Model](capability-model.md#model-providers).

### Capability gateway

- invoke local functions, remote services, tools, agents, or workflows through
  a common lifecycle;
- enforce declared inputs and permissions;
- normalize progress, completion, failure, timeout, and cancellation;
- keep capability implementations out of Vera's private storage schema.

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
    participant Source as "Registered project source"
    participant Capability as "Selected capability adapter"
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
    Life->>Source: Select bounded tracked context
    Source-->>Life: Hash-verified manifest and contents
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
    Life->>Capability: Ephemeral approved snapshot + bounded authority
    Capability-->>Life: Plan or isolated change + provider metadata
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

This slice now includes a browser-neutral TypeScript client and owner CLI,
generic project and conversation resources, selected
read-only Git context, bounded same-scope multi-turn context, recoverable Vera
reply projection, exact disclosure approval, a provider-neutral specialist
port with a late-bound adapter registry, the default Codex adapter, artifact
identity, flat resource ceilings, and best-effort
cancellation. The model-backed planner remains an explicit provider-neutral
adapter. Ollama, OpenAI, and Gemini implement the same structured-generation
port; provider-specific schemas, credentials, readiness, and errors stay behind
their adapters. Deterministic tests cover interrupted invocation, cancellation
recovery, conversation-scope isolation, and reply-projection recovery; a
compiled persistent-mode journey verifies artifact and complete dialogue
survival across process restart plus Redis projection reconstruction. Remaining
The owner accepted the exact real-cloud-Codex disclosure and resulting artifact
on 25 August 2026, completing the V1 evidence boundary.

The same lifecycle now also implements `software_change@1`. Its Codex adapter
uses a workspace-write sandbox over a disposable approved snapshot, while the
registered repository remains untouched. Vera derives an authoritative Git
patch and file hashes from the snapshot and stores a review-only
`software_change` artifact. Application, commit, push, and pull-request effects
remain outside this capability. The deterministic adapter drives the compiled
persistent journey without downloads or third-party calls. See
[ADR-0017](decisions/0017-produce-software-changes-as-isolated-patch-artifacts.md).

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
Mac Mini account and SSH session as its owner perimeter, maps admitted requests
to `owner_v1`, and requires application authentication before broader exposure
under [ADR-0014](decisions/0014-use-the-host-session-as-the-v1-owner-boundary.md).
Health is process liveness.
Readiness verifies provider connectivity, configured-model availability,
MongoDB, Redis, worker lease access, lifecycle recovery, and
planning- and software-change-specialist availability without running
inference.

## Proposed API resource shape

The initial conversation proposed a single endpoint with an optional `flow_id`,
then evolved toward flow-oriented resources. The refined domain model separates
the user-visible conversation from executable work.

The implemented V1 lifecycle paths are:

```text
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
