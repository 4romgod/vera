# Vera Capability Model

**Status:** Accepted (capability declaration shape, invocation lifecycle,
selection checks, and resource/delegation budget model)
**Version:** 0.1
**Last updated:** 24 August 2026
**Accepted:** 24 August 2026 (owner) — V1 capability selected during
ratification; future registry design remains open

## Purpose

Vera's central product promise depends on delegation. This document defines how
models, tools, services, agents, and entire specialist workflows fit beneath
Vera without becoming hard-coded parts of its identity.

## Delegation hierarchy

```mermaid
flowchart TD
    U["Owner intent"] --> V["Vera"]
    V --> D{"Direct response or delegation?"}
    D -->|"direct"| M["Reasoning model through model gateway"]
    D -->|"delegate"| R["Capability registry and policy"]

    R --> DEV["Software development capability"]
    R --> AWS["Cloud investigation capability"]
    R --> RESEARCH["Research capability"]
    R --> TOOL["Bounded tool or service"]

    DEV --> DW["Specialist orchestrator / workflow"]
    AWS --> AW["Specialist orchestrator / workflow"]
    RESEARCH --> RW["Specialist agent or service"]
```

Vera may invoke another orchestrator. The child workflow does not need Vera's
entire personal context; it receives only the task, data, and authority required
for its specialty.

## Capability definition

A capability is a versioned promise that bounded work can be requested through
a declared contract.

Its implementation may be:

- deterministic application code;
- a local executable;
- an HTTP service;
- an MCP server or client integration;
- a model-assisted agent;
- a durable specialist workflow;
- a remote platform such as Codex;
- a human-in-the-loop operational process.

Vera chooses capabilities, not internal implementation nodes.

## Capability declaration

An eventual declaration should cover at least:

```text
identity
  name
  version
  owner
  description

contract
  input_schema
  output_schema
  event_schema
  error_schema

execution
  synchronous | asynchronous
  expected_duration
  timeout_policy
  cancellation_support
  idempotency_scope
  retry_classification

authority
  required_permissions
  credential_scopes
  data_classifications
  side_effect_classes
  approval_policy

operations
  health
  availability
  cost_metadata
  artifact_types
  observability_links
```

The exact schema is not yet accepted. The semantic categories are required for
safe selection and execution.

## Capability invocation lifecycle

```mermaid
stateDiagram-v2
    [*] --> Proposed
    Proposed --> Rejected: invalid or unauthorized
    Proposed --> WaitingForApproval: policy requires owner decision
    WaitingForApproval --> Rejected: denied or expired
    WaitingForApproval --> Ready: approved
    Proposed --> Ready: policy allows
    Ready --> Invoking
    Invoking --> Running: capability accepts
    Invoking --> Failed: invocation error
    Running --> Succeeded
    Running --> Failed
    Running --> TimedOut
    Running --> CancellationRequested
    CancellationRequested --> Cancelled
    CancellationRequested --> Succeeded: completed before cancellation
    CancellationRequested --> Failed
```

Cancellation is a protocol, not a magical rollback. A capability must declare
what cancellation can stop and which completed external effects remain.

## Capability selection

A model may propose a capability based on descriptions and structured inputs.
Vera's code must then verify:

- the capability and version exist;
- the capability is healthy and available;
- the input matches its schema;
- the principal is authorized;
- the data is allowed to cross the capability's trust boundary;
- cost and policy limits are satisfied;
- the invocation and any proposed child work fit within the run's remaining
  resource and delegation budget;
- required approval has been granted;
- a safe idempotency identity exists for side effects.

The model does not invent a capability, permission, credential, or contract.

## Resource and delegation budgets

Every run must have a finite budget envelope enforced by Vera's deterministic
policy layer. The envelope may constrain:

- monetary spend or provider-specific usage units;
- model calls and tokens;
- capability invocations;
- steps and wall-clock duration;
- retries per operation and across the run;
- child-task count;
- delegation depth.

A child task receives an explicitly allocated portion of its parent's remaining
budget. Creating a child must not reset or expand the total envelope. A
specialist workflow may enforce stricter internal limits, but it cannot weaken
Vera's outer limit.

When a limit is reached, Vera stops scheduling new work and records the reason.
It may fail safely, return a partial result, or request a narrowly scoped budget
extension from the owner. A model cannot approve or silently increase its own
budget.

V1 must use finite configured values and demonstrate enforcement. The exact
numbers remain an owner decision.

## Model providers

Models supply reasoning or generation. They are accessed through a model gateway
with a related but specialized contract:

- supported input modalities;
- context limits;
- structured-output support;
- tool support;
- latency and cost characteristics;
- local or remote execution;
- data-handling constraints;
- provider-specific failure modes.

Ollama is a local model provider. A model hosted in Ollama may classify intent,
draft a plan, summarize results, or converse. Ollama itself is not Vera's
orchestrator and does not decide what infrastructure Vera may control.

## Example: development workflow

The original discussion described an existing development workflow as a model
for specialist orchestration:

```mermaid
flowchart TD
    J["Jira ticket"] --> RT["Retrieve ticket details"]
    RT --> P["Planner agent"]
    P --> PR["Plan reviewer agent"]
    PR -->|"changes requested, bounded iterations"| P
    PR -->|"approved"| DEV["Developer agent"]
    DEV --> CR["Code reviewer agent"]
    CR -->|"changes requested"| DEV
    CR -->|"approved"| QG["Deterministic quality gate"]
    QG -->|"tests or lint fail"| DEV
    QG -->|"all checks pass"| PULL["Create pull request"]
```

Some nodes reason with models; others execute deterministic checks. The workflow
as a whole is an orchestrator.

Vera's responsibility is not to reproduce those internal nodes. Vera should:

1. recognize that the request concerns software development;
2. identify the target project and relevant task;
3. select the approved development capability;
4. pass a versioned work request and bounded authority;
5. observe progress, approvals, artifacts, and outcome;
6. return a coherent result to the owner.

## External workflow boundary

```mermaid
sequenceDiagram
    participant Vera
    participant Adapter as Capability adapter
    participant Workflow as Specialist workflow

    Vera->>Adapter: Invoke(version, input, authority, idempotency key)
    Adapter->>Workflow: Provider-specific start request
    Workflow-->>Adapter: External execution ID
    Adapter-->>Vera: Invocation accepted
    loop Until terminal
        Workflow-->>Adapter: Progress / approval need / artifact
        Adapter-->>Vera: Normalized event
    end
    Workflow-->>Adapter: Terminal outcome
    Adapter-->>Vera: Versioned result or classified failure
```

Provider-specific identifiers and payloads may be recorded as adapter metadata,
but they must not replace Vera's task, run, event, and artifact concepts.

## Child tasks versus capability calls

A capability invocation should create a child task when the delegated work:

- has an independently useful owner-visible outcome;
- may outlive or be controlled separately from its parent;
- requires its own approvals or authority boundary;
- may itself coordinate multiple capabilities;
- should appear independently in the client's task list.

A short bounded operation may remain a step and invocation inside the existing
run.

## Versioning and compatibility

- Runs record the exact capability contract version used.
- Breaking input, output, event, permission, or semantic changes create a new
  version.
- Adapters may translate old contracts during a declared migration period.
- Capabilities must not read Vera's private database tables as their API.
- Removal requires handling tasks that still reference an older version.

## V1 capability requirement

V1 needs one real capability, not a catalog of hypothetical integrations. The
selected capability is `development_planning@1`, initially backed by Codex. It
accepts a ticket and an explicitly selected, read-only project context and
returns one versioned implementation-plan artifact.

For V1:

- Vera invokes it through a versioned adapter contract after validating input;
- the capability receives only context displayed in the approval request;
- raw credentials are never capability input;
- invocation state, progress, errors, and artifacts are exposed through Vera's
  polled resources;
- cancellation is best-effort and its observed outcome is recorded;
- sending scoped context to cloud Codex requires explicit approval; and
- success means one schema-valid plan artifact is durably associated with the
  invocation, using that invocation ID as the idempotency identity.

The exact adapter mechanism remains an output of the capability-boundary
experiment. See the [V1 Definition](v1-definition.md#required-first-journey).
