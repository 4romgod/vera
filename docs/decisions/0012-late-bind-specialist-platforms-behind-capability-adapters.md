# ADR-0012: Late-bind specialist platforms behind capability adapters

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera exists to choose and coordinate specialists so its owner does not need to
manually select a platform for every request. The first production planning
specialist uses Codex, but Codex is one implementation choice rather than the
definition of software planning. If vendor identity enters task, capability,
project, or artifact semantics, changing to Claude Code or another specialist
would require a breaking domain migration.

Vera cannot be unaware of the selected platform. Authorization must name the
exact destination, provider, transport, and data boundary before approved
context crosses that boundary. Platform independence therefore means late
binding with explicit runtime identity, not an opaque invocation.

## Decision

`development_planning@1` remains the stable, provider-neutral capability.
Specialist implementations are selected by a composition-root adapter registry.
The initial registered adapter identities are:

- `codex_cli`, the default production adapter; and
- `structured_model`, the local/conformance adapter backed by Vera's configured
  structured-model provider.

Each adapter exposes a destination descriptor containing:

- a stable `adapterId`;
- the actual `provider`;
- its `transport`; and
- whether disclosed data remains `owner_controlled` or crosses to a
  `third_party`.

The approval records that descriptor together with the exact context manifest.
The model may propose `development_planning@1`, but code selects the registered
adapter and supplies the destination. The invocation and artifact copy the same
descriptor. Execution and restart recovery resolve this persisted destination,
not the adapter currently selected for new work. Artifacts retain generic
producer metadata and do not depend on a vendor-specific task type.

Adding Claude Code requires a `claude_code_cli` adapter and its composition
configuration. It must not require a new planning capability version, project
schema, task lifecycle, context format, or artifact type unless its semantics
actually differ from `development_planning@1`.

## Rationale

Capability identity describes what Vera needs done; adapter identity describes
who performs it. Separating them permits provider replacement while keeping
authorization truthful and execution history auditable. A small explicit
registry is preferable to a speculative plugin framework while only two
implementations exist.

String adapter/provider/transport identities allow additive registration of new
platforms without expanding a vendor enum in the durable approval schema. The
data-boundary field remains a closed policy classification because it controls
authorization meaning.

## Consequences

- Codex remains tested and usable, but it is not a domain dependency.
- Runtime configuration selects an adapter ID; unknown IDs fail startup rather
  than silently falling back.
- Changing the selected adapter affects only new approvals. Previously approved
  work uses its recorded adapter or fails closed if that exact destination is no
  longer resolvable.
- Existing `codex` and `model` configuration values remain compatibility aliases
  for `codex_cli` and `structured_model`.
- Persistent startup migrates pre-ADR approval destinations from the temporary
  `{kind, trust}` shape to the versioned generic descriptor before installing
  the current MongoDB validator. It also renames the temporary external-only
  approval reason to `specialist_capability_invocation` so owner-controlled
  adapters are represented truthfully. Migrated aggregate versions advance so
  stale Redis projections cannot mask the new authoritative contract.
- Approval clients render generic destination fields rather than branching on a
  Codex-specific `kind`.
- Every new adapter must declare readiness, destination identity, data boundary,
  cancellation behavior, and contract conformance.
- Provider-specific commands, prompts, and authentication checks remain inside
  their adapter.

## Alternatives considered

### Make Codex the planning capability

Rejected because it confuses a replaceable provider with the stable work
contract and would make provider changes breaking domain changes.

### Hide the provider completely

Rejected because the owner could not make an informed disclosure decision and
historical execution would not be auditable.

### Build a general plugin marketplace now

Rejected because the current requirement is a clean substitution boundary, not
dynamic third-party code installation. The explicit registry can evolve when a
real independent plugin lifecycle exists.

### Let the orchestration model choose arbitrary adapter names

Rejected because model output is a proposal, not registration, authorization,
or execution policy.

## Follow-up

- Implement `claude_code_cli` only when it will be configured and tested against
  the same conformance suite.
- Add policy-based adapter selection when there is evidence for more than one
  simultaneously available production specialist.
- Preserve destination descriptors in any future UI so approval never reduces
  to a generic “allow” button.
