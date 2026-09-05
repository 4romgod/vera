# ADR-0044: Generate the TypeScript SDK with Hey API and Axios

**Status:** Accepted
**Date:** 5 September 2026

## Context

ADR-0043 established the generated OpenAPI 3.1 document and retained
`@vera/client` as Vera's stable SDK boundary. The next step needs a generator
that consumes OpenAPI 3.1, emits TypeScript operation types and functions, and
can coexist with the package's higher-level runtime behavior.

Vera also needs deterministic reviewed output, isolated configuration per
`VeraClient` instance, compatibility with the existing injected `fetch` test
seam, and runtime enforcement of the same response schemas.

## Decision

Use the exactly pinned `@hey-api/openapi-ts` generator with its bundled Axios
client plugin. Keep Axios as an exactly pinned runtime dependency.

Generate all operations, API types, and Zod schemas into
`packages/client/src/generated`. Generated files are ignored build artifacts,
formatted during generation, and produced during package installation or once
at the start of the root verification workflow. Build, test, and typecheck do
not each regenerate independently because those commands may run concurrently.
The generator configuration explicitly selects the TypeScript, Axios, Zod, and
flat SDK plugins rather than relying on changing defaults. Generated operations
validate successful responses with their generated Zod schemas.

The OpenAPI schemas are closed. A deterministic post-generation step converts
generated Zod object schemas to strict objects so response validation rejects
undeclared properties instead of stripping them.

Each `VeraClient` creates its own generated client with that instance's base
URL. Axios uses its fetch adapter with either the caller's injected `fetch`
implementation or the global implementation. This preserves the established
portable `fetch(url, init)` seam.

The package root exports the complete generated surface and an isolated
`createVeraGeneratedClient` factory. New endpoints can be consumed directly
without adding handwritten client methods. The existing facade remains as a
compatibility and ergonomics layer: all ordinary JSON endpoints delegate their
paths, methods, queries, headers, bodies, static types, and runtime validation
to generated operations while retaining stable method names, `VeraApiError`,
cancellation, and polling behavior. Binary upload and transcription handling,
preview URL construction, and resumable server-sent events remain handwritten
protocol adapters.

Handwritten API contract modules and validator implementations are removed.
Previously exported validator and type-guard names remain as compatibility
wrappers over generated Zod schemas. Any retained public aliases are derived
from generated types; handwritten object types describe SDK-only behavior such
as wait options and notification stream events.

## Consequences

- The OpenAPI document now produces typed functions for every public operation.
- The OpenAPI document is the only source of API request, response, and resource
  types, as well as client-side response validation.
- API contract changes require `npm run openapi:generate` followed by
  `npm run client:generate`.
- `npm run check` detects OpenAPI drift, generates the client, and compiles all
  generated and handwritten consumers together.
- Consumers do not depend on a mutable generated singleton; every Vera client
  has isolated transport configuration.
- Axios errors from migrated operations are translated back into Vera's stable
  error envelope at the facade boundary.
- The generic handwritten JSON request builder and its duplicated endpoint
  metadata have been removed.
- Generated implementation files are not linted or internally type-checked;
  their generated public types and every handwritten use remain type-checked.
  This isolates generator templates that are not compatible with the
  repository's TypeScript 6 `exactOptionalPropertyTypes` setting.
- A compatibility method needs handwritten code only when it adds SDK behavior;
  ordinary future endpoints are available through the generated surface.

## Alternatives considered

### Generate a Fetch client

Rejected for this client after selecting Axios as the transport. The existing
`fetch` injection seam is preserved through Axios's fetch adapter.

### Expose generated functions as the only public API

Rejected as a breaking change. Generated functions are public, but the
compatibility facade retains error normalization, polling, upload, and streaming
behavior for existing consumers.

### Continue writing every request by hand

Rejected. It preserves duplicate endpoint types, paths, headers, and status
knowledge and therefore preserves the drift ADR-0043 was created to remove.

## Follow-up

- Review generated diffs and compatibility deliberately when upgrading Hey API,
  Axios, or Zod.
- Replace handwritten binary and SSE adapters only when the generator can model
  their protocol semantics without weakening the SDK.
