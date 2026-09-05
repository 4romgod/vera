# ADR-0043: Generate OpenAPI from runtime HTTP contracts

**Status:** Accepted
**Date:** 5 September 2026

## Context

Vera's browser-neutral TypeScript client has grown alongside the public HTTP
API. It now repeats request and response types, URL construction, and runtime
validation that already exist as Zod and JSON Schema contracts in the API. A
change can therefore be correct at the server boundary while the handwritten
client contract silently drifts.

The client also contains behavior that is not mechanical HTTP plumbing:
normalized Vera errors, binary uploads, resumable server-sent events, polling
with cancellation and timeouts, and an interface used for dependency injection.
Replacing all of that with generator output would weaken the SDK boundary.

## Decision

The Fastify route graph and its Zod-derived request and response schemas remain
the source of truth. Vera generates and checks in an OpenAPI 3.1 document at
`apps/api/openapi/vera.openapi.json` from a complete dependency-free instance of
that same route graph.

Generation adds stable operation identifiers, domain tags, explicit success
and error statuses, the shared JSON error envelope, creation-location headers,
binary attachment and transcription bodies, binary previews, and resumable SSE
semantics. Every registered route also receives a default error-envelope
response schema so runtime serialization and the published failure shape share
one contract.

The document stays beside the API rather than in a new workspace because it is
an API build artifact, not an independently authored package. The existing
`@vera/client` workspace remains the consumer boundary. Later increments will
generate its mechanical operation types and transport calls from this document
while retaining a small handwritten SDK facade for higher-level behavior.

CI regenerates the document, fails on drift, validates it as OpenAPI, and tests
that the complete production graph and special transports are present.

## Rationale

Code-first generation preserves the runtime Zod contracts and avoids a second
hand-maintained schema language. Building the documentation app through the
production `buildApp` function ensures conditional route registration cannot
diverge from documentation. A checked artifact can be consumed by generators,
documentation tools, and non-TypeScript clients without booting Vera's stores
or providers.

Keeping the SDK facade preserves deliberate cross-runtime behavior while
removing the large class of endpoint and type declarations that machines can
generate reliably.

## Consequences

- Every public route needs complete Fastify request and response schemas.
- Error status documentation is centralized and must be updated with error
  mapping changes.
- Binary and streaming endpoints require explicit OpenAPI representation because
  ordinary JSON Schema route discovery cannot infer their wire format.
- Repeated nested schemas become deterministically named semantic components to
  keep the contract small enough for code generators without opaque hash names.
- A route or schema change is incomplete until `npm run openapi:generate` has
  updated the checked artifact and `npm run openapi:check` passes.
- `@vera/client` remains stable while its internals migrate incrementally.

## Alternatives considered

### Hand-author an OpenAPI YAML document

Rejected. It would become another contract that can drift from the schemas the
server actually validates and serializes.

### Put the document in a new npm workspace

Deferred. A workspace that only wraps generated JSON adds release and build
ordering without adding ownership. It may become useful if Vera publishes the
contract independently or extracts shared schema tooling.

### Replace `@vera/client` directly with unwrapped generator output

Rejected. Generic operation clients do not encode Vera's polling, SSE resume,
binary upload, runtime validation, and normalized error behavior.

## Follow-up

- ADR-0044 selects the pinned Hey API generator and Axios transport and
  generates the low-level client into a machine-owned directory.
- Continue migrating one domain at a time behind the existing `VeraApi` facade.
- Replace mechanical handwritten contracts and validators only after equivalent
  generated coverage exists.
