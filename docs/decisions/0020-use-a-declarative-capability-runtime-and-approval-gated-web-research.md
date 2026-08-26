# ADR-0020: Use a declarative capability runtime and approval-gated web research

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera's first two specialist capabilities proved the durable lifecycle, but the
task lifecycle still knew how to execute each capability by name. Adding a
third capability would have extended that branching, duplicated destination
resolution and artifact handling, and made the model-visible capability set
drift from what the process could actually execute.

The next capability must also demonstrate that Vera is not a coding assistant.
Public-web research is useful across every project and for requests with no
project at all. It crosses a different authority boundary from repository work:
the owner question is disclosed to a third-party provider, the provider may
read public web pages, no project context is required, and the result needs
durable source evidence.

## Decision

Vera will route specialist execution through one declarative capability
runtime registry. Each registered capability declares:

- stable name, version, description, proposal-argument schema, and artifact;
- required project-context mode;
- network, data-class, side-effect, credential, and approval authority;
- whether an adapter is enabled and its concrete destination; and
- readiness and execution functions behind the shared runtime port.

Only enabled capability references enter the orchestration model's prompt and
structured-output schema. `GET /v1/capabilities` exposes all declarations and
their enabled state, but never credentials. An approval freezes the selected
destination, effective runtime authority within the declaration's maximum
envelope, exact proposed arguments, and any required project context. Execution
and recovery resolve that frozen destination and authority; they
must not redirect work to whichever adapter is selected later.

Add `web_research@1` as the first project-independent capability. Its contract:

- accepts one bounded `objective` inferred from the owner request;
- requires explicit approval for third-party disclosure and public-web reads;
- receives no project identity, repository context, memory, or credentials;
- permits at most four web-search calls inside the existing run budget;
- returns one durable `research_report` artifact containing the exact objective,
  Markdown report, deduplicated HTTP(S) sources, and search timestamp; and
- fails closed if the adapter cannot prove that a web search occurred or
  returns no cited source.

The initial live adapter is `openai_web_search`, implemented with the OpenAI
Responses API web-search tool. It is configured independently from Vera's
orchestration model and has no automatic fallback. Research is disabled by
default. `deterministic_research` exists only for repeatable local, CI, and
contract evidence.

## Rationale

The registry makes capability availability one runtime fact shared by model
routing, catalog inspection, readiness, approval, execution, and recovery.
Provider-specific parsing remains in adapters; artifact identity, approval,
budgets, events, and persistence remain in Vera's application and domain code.

Web research is a strong architectural test because it does not fit the
project-context assumptions of planning and software change. Supporting it
without fake projects proves that the capability boundary can grow beyond
coding while retaining explicit authority and durable evidence.

## Consequences

- Adding a capability requires a declaration, runtime registration, adapter,
  typed artifact, configuration, and conformance evidence; it does not require
  another branch in the task lifecycle.
- A disabled capability cannot be proposed by the model, even though its
  declaration remains discoverable to owners and operators.
- Approval resources become more informative and stable by recording effective
  runtime authority as well as destination and arguments.
- Research credentials remain server-managed transport configuration and never
  become model proposal, invocation content, events, artifacts, or catalog data.
- OpenAI is an initial adapter, not part of `web_research@1` identity. A later
  Gemini, local, MCP, or specialist-workflow adapter may implement the same
  contract without changing task or artifact semantics.
- The current authority declaration is intentionally finite and executable. A
  richer permission or cost language requires a later versioned decision.

## Alternatives considered

### Add another task-lifecycle branch

Rejected because every new capability would increase coupling, make recovery
logic capability-specific, and eventually turn the orchestrator into a switch
statement over vendors and features.

### Give the orchestration model a generic tool-calling surface

Rejected because a model-visible tool list does not establish durable
idempotency, approval, budget, destination, artifact, or recovery semantics.
Models propose; Vera code controls effects.

### Treat research as a direct model response

Rejected because ordinary orchestration generation neither proves a current
web search nor preserves source evidence, and it would hide the disclosure and
network authority from the owner.

### Couple research to project context

Rejected because many research questions are personal or cross-project. A
synthetic project would broaden data access and pollute Vera's domain model.

### Enable live research by default

Rejected because it would make startup or ordinary reasoning depend on a paid
third-party credential and could create an unreviewed disclosure expectation.

## Follow-up

- Add another live adapter only with the same source-evidence, readiness,
  privacy, and failure conformance tests.
- Add explicit monetary budgets when Vera begins tracking provider spend.
- Generalize progress events if a capability needs owner-visible intermediate
  research steps rather than one bounded terminal report.
- Consider separating workers from the API process when capability duration or
  deployment evidence justifies another runtime.
