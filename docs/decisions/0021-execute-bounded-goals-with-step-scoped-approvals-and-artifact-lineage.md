# ADR-0021: Execute bounded goals with step-scoped approvals and artifact lineage

**Status:** Accepted
**Date:** 26 August 2026

## Context

Vera can already answer directly or invoke one specialist capability. That is a
sound control-plane foundation, but it cannot satisfy an assistant-level request
whose useful outcome crosses capability boundaries. “Research the current
options, plan the change, and implement it” is one owner goal, not three commands
the owner should have to coordinate manually.

Allowing a model to run an open-ended agent loop would solve the ergonomics by
discarding the properties Vera has established: finite budgets, durable state,
exact approvals, provider-neutral capabilities, idempotent effects, and
recoverable evidence. Treating one broad approval as permission for an entire
model-authored plan would also make later disclosures and effects impossible to
review accurately.

## Decision

Vera may execute a validated `GoalPlan@1` inside one task and run. A plan has one
owner-facing objective and two or three ordered capability steps. Each step:

- names an enabled capability and immutable contract version;
- contains only that capability's proposal arguments;
- may depend only on earlier steps; and
- may consume an earlier artifact only when its capability declaration accepts
  that artifact type.

The orchestration model may propose the plan, but code validates its structure,
enabled capabilities, dependency order, artifact compatibility, and selected
project identity. The model does not approve or execute any step.

Vera executes the plan sequentially. Before every step it creates a distinct,
durable approval freezing:

- capability and version;
- exact proposed arguments;
- authoritative project identity and context manifest when required;
- selected adapter destination and effective authority; and
- exact input-artifact identities, hashes, media types, and byte lengths.

Completed approvals and invocations remain in the run's bounded history when
the next step becomes current. Replaying a matching historical decision is
idempotent; a conflicting decision fails. Before execution or recovery, Vera
loads each artifact from owner-scoped durable storage, recomputes its content
integrity, verifies its reference and project scope, and checks that the runtime
accepts its type. The produced artifact records those references as immutable
lineage.

One initial model call may create the plan. The default run budget permits at
most three capability invocations, one per goal step. Rejection, failure,
cancellation, or budget exhaustion stops the remaining plan and records the
active step's terminal state. Vera does not automatically replan, skip a failed
step, or broaden an approval.

This increment keeps the goal inside one run because every step serves one
short, bounded owner outcome and shares one lifecycle. A future delegated
workflow with independent control, lifetime, budget, or nested approvals should
be represented as a child task instead.

## Rationale

This is the smallest move from command routing toward a general assistant that
can pursue outcomes. It gives the owner one natural-language entry point while
keeping authority at each real boundary. Typed artifacts are a safer handoff
than concatenated prompts: they are versioned, integrity-checked, inspectable,
and compatible by declaration.

The bounded plan is intentionally less autonomous than an unrestricted agent
loop. It provides a deterministic execution substrate on which later planning,
replanning, memory, schedules, notifications, and richer policies can grow
without replacing the task, approval, capability, or artifact model.

## Consequences

- `ModelProposal@1` gains `execute_goal`; disabled capabilities remain absent
  from the model-visible schema.
- Runs may expose a goal projection, approval/invocation histories, step events,
  and a `goal_result` containing two or three artifact references.
- Capability declarations must state accepted input-artifact types. Receiving
  artifact content adds an explicit data class to that step's approval.
- Planning and software-change specialists can receive approved prior artifacts
  without gaining access to Vera's database or another capability's private
  state.
- Clients must be prepared for another `awaiting_approval` state after one step
  succeeds. Interactive chat reviews each approval separately.
- Legacy single-capability runs remain valid because all new aggregate fields
  are optional and existing output contracts remain supported.
- The compiled persistence journey must prove process-restart recovery between
  steps, historical approval idempotency, exact artifact lineage, and one final
  goal result.

## Alternatives considered

### Keep every request to one capability

Rejected because the owner would remain the workflow engine. Vera would route
commands but would not pursue compound outcomes.

### Give the model an unrestricted tool loop

Rejected because iteration count, authority, recovery, and evidence would be
implicit in provider behavior rather than enforced by Vera.

### Approve the whole goal once

Rejected because later steps can have different destinations, disclosures,
network access, artifact inputs, and side effects. An early blanket approval
cannot truthfully describe them.

### Create a child task for every step

Deferred for independently controllable delegated work. It adds unnecessary
identity and lifecycle overhead to a short two- or three-step goal and does not
remove the need for artifact lineage.

### Pass prior output as untyped prompt text

Rejected because it loses provenance, integrity, compatibility, and a precise
approval boundary.

## Follow-up

- Add goal-level progress summaries suited to graphical and voice clients.
- Design policy-based approval reuse without weakening exact step authority.
- Add child-task delegation for long-running or independently controlled work.
- Define explicit replanning and compensation semantics before either is
  implemented.
- Add more capability contracts so goals extend beyond software and research.
