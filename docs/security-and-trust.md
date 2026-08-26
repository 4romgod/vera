# Vera Security and Trust Model

**Status:** Accepted
**Version:** 0.6
**Last updated:** 26 August 2026
**Accepted:** 24 August 2026 (owner); V1 perimeter clarified by ADR-0014 and
cloud-provider policy clarified by ADR-0015 and bounded conversation disclosure
accepted by ADR-0016 on 25 August 2026
and managed-worktree application accepted by ADR-0018; bounded goal authority
accepted by ADR-0021 and personal-task integration authority accepted by
ADR-0022, with reminder scheduling and inbox authority accepted by ADR-0023 on
26 August 2026; adaptive evidence disclosure and budget authority accepted by
ADR-0024

## Purpose

Vera is intended to reach across personal information, projects, machines,
models, services, and credentials. Security is therefore part of the product
model, not a hardening phase after orchestration works.

This document defines the initial trust posture and the minimum security
properties required even for a single-owner prototype.

## Core rule

> Natural-language intent may propose authority, but it never grants authority.

Permissions come from authenticated identity, configured policy, and narrowly
scoped approvals. Neither a model nor retrieved content can expand them.

## Trust boundaries

```mermaid
flowchart LR
    subgraph Owner["Trusted owner boundary"]
        USER["Owner"]
        CLIENT["Authorized client"]
    end

    subgraph Vera["Vera-controlled boundary"]
        API["Loopback API<br/>owner_v1"]
        KERNEL["Kernel and policy"]
        STORE["Durable state"]
        BROKER["Credential broker"]
        LOCAL["Sandboxed local capabilities"]
    end

    subgraph Untrusted["External or untrusted boundary"]
        CLOUD["Cloud models"]
        CONTENT["Web pages, documents, tool output"]
        REMOTE["Remote capabilities and services"]
    end

    USER --> CLIENT --> API --> KERNEL
    KERNEL --> STORE
    KERNEL --> BROKER
    KERNEL --> LOCAL
    KERNEL -->|"filtered context"| CLOUD
    CONTENT -->|"untrusted data"| KERNEL
    BROKER -->|"scoped secret at execution time"| REMOTE
    KERNEL -->|"validated input and bounded authority"| REMOTE
```

Running a service on the owner's Mac does not automatically make all inputs,
models, packages, or invoked processes trusted.

For V1 only, the trusted owner perimeter is the owner's Mac Mini account plus
authenticated SSH access to Vera's code-enforced loopback listener. This is a
deployment boundary, not a claim that loopback authenticates arbitrary HTTP
callers. See [ADR-0014](decisions/0014-use-the-host-session-as-the-v1-owner-boundary.md).

## Threat categories

### Prompt injection and instruction confusion

Retrieved documents, issue descriptions, web pages, emails, tool outputs, and
capability results may contain text that asks a model to ignore Vera's rules or
perform unrelated actions.

Mitigations include:

- label external material as data rather than instructions;
- keep policy enforcement outside the model;
- minimize context and available tools;
- validate every proposed capability invocation;
- require approval for sensitive effects;
- do not let content select or reveal credentials.

### Excessive agency

A broad generic shell, cloud credential, or filesystem tool can turn a minor
reasoning error into a major side effect.

Capabilities should be narrow, typed, scoped to an environment, and explicit
about effect. Generic execution should occur only in a sandbox with a declared
manifest and policy.

### Credential exposure

Raw credentials must not appear in:

- model prompts or context;
- conversation messages;
- ordinary event payloads;
- logs or traces;
- capability descriptions;
- client bundles;
- generated artifacts.

Models and clients should use opaque credential references. The credential
broker resolves those references only for an authorized invocation and passes
the minimum secret material to the execution environment.

V1 model-provider API keys are a narrower interim case: they are server-only
process configuration passed directly from a provider adapter into an HTTP
authorization header. They are never model input or client-visible state. A
credential broker remains required before Vera distributes capability
credentials or supports multiple principals.

### Cross-task data leakage

Concurrency creates a risk that one task receives another task's context,
artifacts, credentials, or events. Every read and invocation must be scoped to a
principal and the appropriate conversation, task, run, or project.

### Supply-chain and capability compromise

Installed packages, MCP servers, local executables, and remote workflows are
code execution dependencies. Capability registration must not imply unlimited
trust. Versions, origins, permissions, and runtime isolation must be visible.

### Incorrect durable memory

Model inference may be wrong or overly sensitive. Memory promotion requires
provenance, scope, and policy. Consequential inferred facts should be confirmed
rather than silently treated as owner statements.

## Authorization model

Every proposed operation is evaluated against:

```text
principal
  + requested action
  + target resource and environment
  + capability and version
  + data classification
  + requested credential scopes
  + expected side effects
  + cost and rate limits
  + existing approvals
  = allow | deny | require approval
```

Authorization decisions are deterministic and recorded. A model may explain or
recommend but cannot produce its own authorization token.

Integration authority is calculated after action arguments are validated and
before an invocation can execute. A capability's maximum authority is only a
ceiling: the frozen approval must contain the exact authority for that action.
For `personal_task_management@1`, listing discloses `personal_task_data` with no
side effect; create, complete, and reopen additionally require
`personal_data_write`. Switching a local adapter for a remote provider must not
silently inherit network, credential, or third-party disclosure authority.

Personal tasks are owner-scoped durable data. Store reads and mutations include
the principal identity, public HTTP representations omit internal mutation
identifiers, and invocation-based idempotency cannot cross owner boundaries.
The V1 read API remains protected only by the accepted loopback owner perimeter;
it must not be exposed remotely before a stronger identity decision.

## Resource and delegation budgets

Cost control and loop prevention are authorization responsibilities, not prompt
suggestions. Every task and run must have a finite, deterministic budget
envelope covering the resource dimensions relevant to its work.

At minimum, Vera's policy model must be capable of limiting:

- monetary or provider usage cost;
- model calls and tokens;
- execution steps and capability invocations;
- wall-clock duration and individual timeouts;
- retries;
- child-task count and delegation depth.

```mermaid
flowchart TD
    R["Run starts with finite budget envelope"] --> S{"Schedule next step?"}
    S --> C["Check cost, time, retries, invocations, and depth"]
    C -->|"within budget"| E["Execute one bounded step"]
    E --> U["Record actual usage and remaining budget"]
    U --> S
    C -->|"limit reached"| X["Stop scheduling new work"]
    X --> O{"Configured outcome"}
    O --> F["Fail safely"]
    O --> P["Return partial result"]
    O --> A["Request owner-approved extension"]
```

Budget rules:

- child work inherits an allocated portion of the parent's remaining budget;
- delegation never resets cost, retry, time, or depth counters;
- only the authenticated owner or preconfigured policy may extend a budget;
- an extension is scoped, recorded, and re-evaluated before execution;
- exhaustion produces a distinct event and outcome rather than an unexplained
  model failure;
- capability-local limits may be stricter but cannot weaken Vera's envelope.

The original flat V1 envelope allowed one initial model decision and one
capability invocation. The accepted goal increments now permit at most four
model calls and three capability invocations. A fixed goal normally uses one
initial decision; an adaptive goal may use one additional continuation decision
after each of at most three validated observations. Both retain one recovery
retry, ten minutes of run duration, 40 context files, 200,000 total context
bytes, 40,000 bytes per context file, and a 100,000-byte capability artifact.
Context, observation, output, call, invocation, retry, and duration limits are
enforced in code. Each step has its own exact approval; a prior artifact used as
capability input adds an explicit `artifact_content` disclosure and is
hash-checked before use. Evidence that only informed the orchestration decision
is disclosed separately as `decisionEvidence` and is not passed to the next
capability. Model adapters additionally send a
configured maximum output-token request and record provider token usage when it
is returned. The fixed three-step ceiling provides a finite per-operation
boundary without allowing a self-extending model loop.
Cumulative token or monetary accounting is required before increasing those
call counts or enabling provider fallback/routing; absence of measurable usage
must remain explicit.

Adaptive continuation introduces a second model-data boundary because
capability artifacts can contain project, personal, or third-party data not
present in the owner's original request. The implemented rule is fail-closed:
only an `owner_controlled` orchestration provider may receive minimized artifact
type and content, and third-party profiles do not receive the adaptive proposal
schema at all. Recovery with a cloud brain stops before disclosure. Enabling
cloud continuation requires a new exact evidence-disclosure approval policy;
startup provider selection is not sufficient consent. Artifact contents remain
untrusted even inside the owner boundary and cannot grant authority through
prompt instructions.

Natural-language completion is not proof that an effect occurred. Adaptive
plans therefore persist a capability-backed requirement for every requested
outcome. Code rejects completion unless each requirement is resolved exactly
once, each satisfied outcome cites an observation from its declared capability,
and any not-applicable outcome was explicitly conditional and cites evidence.
The owner reply includes a code-authored outcome and execution ledger; model
prose cannot silently manufacture a reminder, task, code change, or other side
effect.

## Approval model

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Policy
    participant Store
    actor Owner

    Orch->>Policy: Proposed action and bounded parameters
    Policy-->>Orch: Approval required
    Orch->>Store: Persist exact approval request
    Store-->>Owner: Present effect, target, data, and expiry
    Owner->>Store: Approve or deny
    Store-->>Orch: Signed decision for exact request
    Orch->>Policy: Re-evaluate at execution time
    Policy-->>Orch: Allow or deny
```

An approval must be narrow enough that the owner understands what will happen.
It should expire and should not silently authorize materially different inputs.

Example approval classes may include:

- read-only access to a named repository or cloud account;
- writing files in a bounded workspace;
- running tests or local commands;
- creating a pull request;
- changing cloud infrastructure;
- sending a message or publishing content;
- spending above a configured model or service threshold.

Exact classes remain to be designed.

## AWS example from the initial discussion

The initial vision said Vera should be able to investigate dashboards by
obtaining credentials for an AWS account or delegating to an AWS specialist.

The secure interpretation is:

1. Vera identifies the target account and read-only investigation capability.
2. Policy checks whether the owner and capability may access that account.
3. If required, the owner approves the exact scope and duration.
4. The credential broker obtains or resolves short-lived, least-privilege
   credentials.
5. Only the AWS execution environment receives the credential material.
6. The model receives normalized results, not the secret.
7. Every access and consequential recommendation is recorded.

Vera should not search the machine for ambient credentials and place them into
a model prompt.

## Data classification

An initial classification scheme should distinguish at least:

- public;
- internal project information;
- personal information;
- confidential business information;
- credentials and cryptographic material;
- highly sensitive personal information.

Provider and capability policies should declare which classes may cross their
boundaries. Redaction does not replace authorization.

Ollama and deterministic model providers are owner-controlled. Selecting an
OpenAI or Gemini startup profile explicitly permits the owner message and
minimal selected-project identity, plus bounded prior complete turns from the
exact same project scope, to cross that third-party model boundary. The frozen
manifest makes this history inspectable and excludes incomplete or other-scope
turns, but remains local: only ordered role/content pairs are disclosed, not
internal task/message IDs, hashes, limits, or exclusion counts. Repository
contents, credentials, unrelated conversations, long-term
memory, and capability authority are excluded. Exact project context sent
through a cloud-backed capability
remains separately approval-gated. Vera never falls back automatically across
provider boundaries. See
[ADR-0015](decisions/0015-select-model-providers-through-explicit-profiles.md)
and
[ADR-0016](decisions/0016-freeze-bounded-conversation-context-and-durably-project-replies.md).

### Isolated software-change boundary

Approval of `software_change@1` grants write authority only inside a newly
created disposable snapshot containing the exact approved context. It does not
grant write authority over the registered repository. The production adapter
must run ephemerally, must not load repository agent-instruction files, and must
not use credentials or network effects. Vera rejects credential-like paths,
agent instruction files, symlinks, binaries, path escapes, generated dependency
trees, and changes beyond the run's file and artifact ceilings.
The subprocess receives an allowlisted runtime environment; Vera's model API
keys, MongoDB and Redis configuration, selected profiles, and unrelated server
variables are not inherited.

The specialist supplies a human-readable report, but Vera derives the patch,
file operations, sizes, and before/after hashes from the resulting filesystem.
Applying that patch, committing it, pushing it, or creating a pull request are
separate effects requiring separate policy and approval. This boundary is
accepted in [ADR-0017](decisions/0017-produce-software-changes-as-isolated-patch-artifacts.md).

### Managed software-change application boundary

The implemented application effect grants only the right to materialize the
exact approved patch on the disclosed branch and stage it inside the disclosed
managed Git worktree. Approval binds the artifact and patch hashes, immutable
base commit, project, path, file manifest, and staged outcome. It grants no
authority over the owner's active checkout, commits, remotes, credentials,
pushes, or pull requests.

Vera serializes mutation per registered project and verifies actual file hashes
and Git index state after execution and recovery. Cancellation may remove an
untouched managed worktree, but it cannot claim to reverse a patch already
staged. Ambiguous or partial state is quarantined as `review_required` for owner
inspection. See
[ADR-0018](decisions/0018-apply-approved-software-changes-in-managed-git-worktrees.md).

## Audit and observability

Security-relevant records include:

- authentication and principal identity;
- proposal validation failures;
- policy decisions;
- approval requests and decisions;
- credential reference use;
- capability invocation and version;
- side-effect identities;
- cancellation and timeout outcomes;
- administrative policy changes.

Audit records must avoid storing the secrets or unnecessary sensitive payloads
they describe.

## V1 security floor

This section remains the accepted security target. V1 establishes its
authenticated owner boundary at the deployment perimeter: the trusted Mac Mini
account and authenticated SSH session admit traffic to a listener whose
configuration permits only loopback. The application uses the explicit
principal `owner_v1` inside that perimeter. This is sufficient only for the
single-owner V1 topology and does not authenticate HTTP callers independently.
Application authentication remains a pre-exposure requirement.

V1 must demonstrate:

- an authenticated owner deployment perimeter with code-enforced loopback;
- one explicit approval-gated external disclosure and capability invocation;
- scoped capability input and authority;
- no raw secrets in model context, logs, events, or artifacts;
- rejection of an unauthorized structured proposal;
- separation between two concurrent tasks;
- finite configured ceilings for model calls, measurable cost or usage,
  wall-clock time or steps, retries, and capability invocations;
- delegation depth fixed at one, with child Vera tasks and recursive delegation
  rejected;
- a demonstrated safe stop when at least one configured ceiling is reached;
- a deterministic audit trail for the demonstrated journey.

The accepted target model above still requires inherited child budgets before
Vera later permits child tasks. V1 proves the simpler safe case by forbidding
them.

## Open questions

- How will application-layer principals be issued, authenticated, and revoked
  before Vera is exposed beyond the V1 host/SSH perimeter?
- Where are credentials stored and how are short-lived credentials obtained?
- Which additional data classes, if any, may future cloud-model policies
  authorize beyond current messages, minimal selected-project identity, and
  bounded same-scope conversation turns?
- What sandbox is required for local command and coding capabilities?
- How are capability packages verified and updated?
- Which approval decisions may be remembered, and for how long?
- What emergency stop or global revocation control is required?
