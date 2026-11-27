# ADR-0057: Clarify uncertain intent through a durable bounded loop

**Status:** Accepted
**Date:** 2026-09-08

## Context

Vera previously had no execution-level distinction between a useful answer and
a request for more information. A model could phrase a response as a question,
but the task then completed. The owner's next message created an unrelated task,
discarding the unresolved intent and forcing capability-specific code to guess,
reject, or grow one-off continuation commands.

Clarification may also become necessary only after a bounded adaptive goal has
inspected durable evidence. A single pre-execution question is therefore not a
general solution.

## Decision

`request_clarification` is a provider-neutral model proposal available both at
initial task evaluation and at evidence-grounded adaptive-goal continuation.
Vera code validates the proposal and persists a versioned clarification ledger
on the existing run. Each round records one focused question, at most three
stable missing-information keys, grounded resolved facts, the exact model
decision, durable question identity, and the owner's durable answer.

An awaiting clarification is a nonterminal run state. The projected question
is delivered through the ordinary conversation path. A valid answer resumes the
same task and run, rebuilds bounded context, and may lead to another question,
an approval, a capability step, or completion. Terminal runs are never reopened.

The loop is bounded by both the run's existing model-call budget and a hard
six-round ceiling. Vera refuses an exact repeated question and stops after two
consecutive rounds that do not resolve any previously missing key. Human waiting
time is durably measured and excluded from the active execution-duration budget.

Conversation clients identify the task they are answering when known. If the
identity is omitted, Vera continues automatically only when exactly one task in
that conversation awaits clarification; multiple candidates return an explicit
conflict. Direct tasks use a task-scoped clarification-answer endpoint.

A clarification answer supplies information only. It never grants approval,
widens capability authority, or authorizes an effect. Project, attachment,
principal, conversation, and external-signal scope checks remain in code, and
every consequential action still receives a fresh exact approval.

## Rationale

This makes uncertainty a first-class, restart-safe lifecycle state instead of a
prompt convention. The same mechanism serves every enabled capability and both
typed and voice conversation, while finite budgets and progress checks prevent
an unbounded model-driven interview.

## Consequences

- Clients must treat `awaiting_clarification` with a projected question as a
  settled interaction boundary, but not as terminal task completion.
- MongoDB stores the full clarification ledger; Redis remains a rebuildable
  projection.
- Recovery leaves unanswered runs dormant and resumes evaluation only after a
  durable owner answer.
- Adaptive-goal continuation history may contain clarification decisions that
  do not add capability steps.
- Concurrent unresolved tasks require exact task identity rather than a
  latest-task guess.
- A capability that has already failed or produced an ambiguous external effect
  still follows its explicit failure/reconciliation contract; clarification
  does not reinterpret unknown effect state.

## Alternatives considered

- **Complete the task with a question and start another task for the answer:**
  rejected because it loses lifecycle identity, facts, budgets, and recovery.
- **Add custom missing-field prompts to each capability:** rejected because it
  duplicates orchestration policy and cannot adapt after new evidence.
- **Allow unlimited clarification:** rejected because it permits model loops and
  unbounded cost.
- **Always attach an answer to the latest task:** rejected because conversations
  may contain concurrent tasks and guessing can cross authority boundaries.

## Follow-up

Evaluate whether the frontend should expose an explicit task chooser when more
than one question is pending. Provider quality and real owner conversations
should inform future tuning of the round and no-progress limits; changing those
limits does not permit removing the hard budget.
