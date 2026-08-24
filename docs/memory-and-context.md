# Vera Memory and Context Architecture

**Status:** Proposed
**Version:** 0.1
**Last updated:** 24 August 2026

## Purpose

The initial discussion used the word `scratchpad` to explore how Vera would
retain temporary information while a request was being processed. It considered
a Markdown file, then Redis, and separately discussed PostgreSQL and vector
search for long-term memory.

That exploration identified a real need, but it combined several different
information lifecycles. This document separates them so that storage products
can be selected against explicit semantics.

## The five information layers

```mermaid
flowchart TB
    H["1. Conversation and event history<br/>What was communicated and what happened?"]
    O["2. Operational state<br/>What is Vera committed to doing now?"]
    C["3. Model context / scratchpad<br/>What does this model call need to see?"]
    M["4. Long-term memory<br/>What selected information should Vera retain?"]
    K["5. Knowledge sources<br/>What external material can Vera retrieve?"]

    H --> C
    O --> C
    M --> C
    K --> C
    C --> P["Structured proposal or response"]
    P -->|"validated transition"| O
    P -->|"governed memory candidate"| M
```

Each layer has different truth, durability, privacy, query, and expiration
requirements. They may share infrastructure, but they must not share semantics.

## Conversation and event history

Conversation history records immutable messages. Event history records
immutable execution facts. Together they answer what was said and what happened.

They are durable evidence, not automatically the context for every future
model call. Passing an entire history increases cost, reduces relevance, and may
cross privacy or provider boundaries.

Examples:

- the owner submitted a message at a particular time;
- Vera created a task from that message;
- a model proposal was accepted or rejected;
- a capability invocation began and produced an artifact;
- an approval was granted by the owner;
- cancellation was requested and later confirmed.

## Operational state

Operational state is Vera's authoritative representation of current
commitments and execution.

It includes:

- conversation metadata;
- tasks and their desired outcomes;
- run and step states;
- capability invocations and idempotency identities;
- approvals;
- current projections derived from events;
- artifact metadata;
- retry, timeout, and cancellation information.

Operational state must survive process restart. It must support atomic or
otherwise safe transitions and prevent two workers from performing the same
side effect accidentally.

This is not a scratchpad and should not be represented primarily as Markdown.

## Model context and scratchpad

Model context is a bounded projection assembled for one model invocation. It can
contain working information such as:

- the current user request;
- a task summary;
- the current plan or step;
- selected recent messages;
- relevant tool or capability results;
- applicable project facts and preferences;
- capability descriptions;
- policy constraints;
- errors the model is being asked to diagnose.

The scratchpad is the optional working portion of this projection: temporary
notes or intermediate structured results useful during reasoning.

Key rules:

- model context is derived from authoritative sources;
- it is scoped to a particular purpose and provider;
- its contents are not all presumed true;
- it cannot grant authority;
- it may expire after the invocation or run;
- durable facts are promoted through an explicit process, not by copying the
  whole scratchpad into memory.

## Long-term memory

Long-term memory answers, "What selected information should Vera be able to use
again?"

Potential classes include:

| Memory class | Example | Default posture |
|---|---|---|
| User-stated fact | "My primary development machine is the Mac Mini." | Retain with provenance if useful. |
| Preference | "Prefer npm workspaces." | Retain and allow correction. |
| Project knowledge | "Gatherle uses a particular development workflow." | Scope to the project. |
| Episodic summary | "A deployment investigation concluded X." | Retain selectively with source links. |
| Capability knowledge | "Capability version 2 supports cancellation." | Derive from registry, not conversational memory. |
| Inference | "The owner may prefer local models for private data." | Mark as inferred and require confirmation when consequential. |

A memory record needs identity, type, subject, scope, provenance, sensitivity,
confidence where relevant, timestamps, and retention/deletion behaviour.

Embeddings or vector indexes are retrieval mechanisms. They are not the memory
model and do not remove the need for provenance or access control.

## Knowledge sources

Knowledge sources are external or repository-backed materials Vera may retrieve
without treating them as personal memory.

Examples include:

- project repositories and documentation;
- issue trackers;
- cloud dashboards;
- uploaded documents;
- API documentation;
- indexed reports;
- capability-provided resources.

Retrieved content is untrusted data. It may be inaccurate, outdated, or contain
instructions intended to manipulate a model. Retrieval does not grant the
content authority over Vera.

## Context assembly

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Policy
    participant History
    participant State
    participant Memory
    participant Knowledge
    participant Model

    Orch->>Policy: Describe purpose, provider, and data needs
    Policy-->>Orch: Allowed scopes and sensitivity limits
    Orch->>History: Select relevant messages and events
    Orch->>State: Read task/run projection
    Orch->>Memory: Retrieve scoped memory with provenance
    Orch->>Knowledge: Retrieve permitted source material
    Orch->>Orch: Rank, redact, bound, and label context
    Orch->>Model: Purpose-built context + output schema
    Model-->>Orch: Proposal or response
```

The context assembler should be observable. Vera should be able to explain at a
useful level which sources influenced a decision without exposing protected
system prompts, secrets, or irrelevant private content.

## Example: development request

For "Vera, continue the authentication ticket in Gatherle," a context package
might include:

- the current conversation message;
- the explicit identity of the Gatherle project;
- the referenced ticket and its retrieved details;
- the declared development capability and its input schema;
- the task's existing run history, if this is a continuation;
- project-specific approval rules;
- a memory stating the owner's tooling preference, with provenance;
- a prohibition against including unrelated personal conversations.

It should not automatically include every prior chat, every repository file,
raw GitHub or Jira tokens, or state from an unrelated AWS investigation.

## Storage implications

### Markdown

Markdown is appropriate for project design, human-readable reports, selected
artifacts, and debugging exports. It is not an adequate authoritative store for
concurrent runtime transitions.

### PostgreSQL

PostgreSQL is the leading candidate for durable operational state and structured
memory because it can express relationships, transactions, constraints, and
migrations. This is a proposed decision pending a persistence experiment.

### Redis

Redis remains a possible supporting component for caches, leases, rate limits,
queues, pub/sub, and short-lived coordination. It should not become the sole
source of active-run truth merely because the original concept used the word
scratchpad.

### Artifact storage

Large files should not necessarily live in the operational database. Vera may
store content locally or in object storage while retaining durable metadata,
integrity information, and access rules in the authoritative store.

## Promotion into memory

```mermaid
flowchart LR
    E["Message, event, or result"] --> X["Extract memory candidate"]
    X --> V["Validate type, scope, and provenance"]
    V --> P{"Policy / approval"}
    P -->|"reject"| D["Discard candidate"]
    P -->|"accept"| M["Persist versioned memory record"]
    M --> R["Review, correct, expire, or delete"]
```

Vera must distinguish user-stated information from model-derived inference. A
future user interface should allow the owner to inspect and correct meaningful
memory.

## Decisions still required

- Which memory classes, if any, are allowed in V1?
- What operational data retention is required?
- Will model contexts be retained for debugging, redacted, or discarded?
- Which data may be sent to each provider?
- What is the initial authoritative database and migration strategy?
- When is memory promotion automatic, approval-based, or forbidden?
- How will deletion propagate to derived indexes and artifacts?

Related persistence reasoning is recorded in
[ADR-0007](decisions/0007-separate-durable-state-from-model-context.md).
