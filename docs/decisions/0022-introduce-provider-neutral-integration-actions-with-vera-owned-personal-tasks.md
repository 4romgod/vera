# ADR-0022: Introduce provider-neutral integration actions with Vera-owned personal tasks

**Status:** Accepted
**Date:** 26 August 2026

## Context

Bounded goals let Vera coordinate capabilities, but the implemented capabilities
still concentrate on software and public research. A personal assistant must be
able to inspect and change owner state. Connecting directly to a calendar or
task vendor now would make the first personal capability depend on credentials,
application authentication, remote availability, and one provider's data model.

Treating every integration as bespoke lifecycle code would also recreate the
same routing, approval, recovery, and authority logic for every service.

## Decision

Vera introduces a provider-neutral `IntegrationActionExecutor<Arguments,
Result>` port. An integration adapter declares:

- a stable integration identity and provider-neutral destination;
- its maximum authority;
- the exact authority required for each typed action;
- readiness; and
- an idempotent owner-scoped execution operation.

The first adapter is Vera-owned personal task storage. The
`personal_task_management@1` capability supports four closed actions: `create`,
`list`, `complete`, and `reopen`. It stores personal tasks in MongoDB in
persistent mode and in the memory adapter for deterministic tests. It requires
no external account, network access, or credentials.

Every conversational invocation still requires an exact approval. Listing
discloses `personal_task_data` but no write effect. Create, complete, and reopen
also disclose `personal_data_write`. The model proposes only action arguments;
Vera code supplies principal identity, invocation identity, destination,
authority, recovery state, and mutation ordering.

Task creation is deterministic by invocation identity. Status mutations use
optimistic concurrency, monotonic stored timestamps, and invocation identity so
fresh actions serialize while a recovered older invocation cannot overwrite a
newer mutation. Every invocation produces a `personal_task_result` artifact as
durable evidence.

Read-only `GET /v1/personal-tasks` and `GET /v1/personal-tasks/{id}` paths expose
the resulting owner resources to clients. They do not create a second mutation
path. The current loopback-only owner perimeter remains unchanged.

## Rationale

Vera-owned tasks make the assistant useful outside software without blocking on
authentication or a third-party product choice. The integration port preserves
the capability lifecycle while allowing a future calendar, Todoist, reminders,
or another service adapter to replace or complement local storage.

Per-action authority matters because reading a task list and changing it are
not the same effect. Freezing that distinction in approval is safer and more
extensible than assigning one broad integration permission to every action.

## Consequences

- Personal tasks are durable owner resources, not long-term model memory.
- `owner_state` becomes a capability effect class alongside external specialist
  execution.
- Capability runtimes must resolve exact invocation authority within their
  declared maximum; execution fails if that authority changes after approval.
- The orchestration runtime supplies principal and recovery context to adapters
  without disclosing those fields to external models by default.
- External calendar/task synchronization, reminders, recurrence, background
  triggers, and conflict resolution remain separate future decisions.
- Broader network exposure still requires application authentication.

## Alternatives considered

### Integrate Todoist or a calendar provider first

Deferred because it would force credential, OAuth, synchronization, and vendor
decisions before validating Vera's personal-action contract.

### Store tasks only as conversation text or memory

Rejected because actionable owner state needs typed identity, status,
idempotency, querying, and mutation semantics.

### Permit direct HTTP mutation endpoints

Rejected for this increment. It would create a second effect path that bypasses
the orchestration approval and evidence lifecycle.

### Give every personal-task action write authority

Rejected because listing is read-only and approval should describe the exact
effect being authorized.

## Follow-up

- Add reminders and scheduled triggers as durable resources, not in-process
  timers.
- Add an external task/calendar adapter only after credential and synchronization
  policy is accepted.
- Generalize integration registration further when a second provider proves
  which abstractions are genuinely shared.
- Design approval-policy reuse without silently approving personal mutations.
