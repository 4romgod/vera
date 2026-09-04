# ADR-0019: Organize the API as an inward-dependent modular monolith

**Status:** Accepted
**Date:** 25 August 2026

## Context

The API has grown from one decision endpoint into conversations, projects,
tasks, workers, model providers, capability adapters, persistence, artifacts,
and controlled Git effects. Flat layer folders made related files harder to
find, while grouping only by technology produced inconsistent categories:
MongoDB lived under adapters, but model and specialist adapters did not.

Premature workspace packages or services would add release and dependency
cost without a second consumer or independent runtime. The source tree still
needs boundaries strong enough to grow safely inside one deployable API.

## Decision

Keep `apps/api` as a modular monolith and organize it first by architectural
role, then by cohesive responsibility:

- `domain/<concept>` for versioned business concepts and invariants;
- `ports/<boundary>` for provider-neutral interfaces required by the core;
- `application/<use-case>` for lifecycle and coordination logic;
- `adapters/inbound/<transport>` for HTTP and later delivery mechanisms;
- `adapters/outbound/<boundary>/<technology-or-capability>` for persistence,
  models, specialists, project context, and controlled effects; and
- `bootstrap` for environment loading, configuration, adapter selection,
  composition, and process startup.

Tests mirror these roles where useful. Architecture tests enforce that domain
and application code do not import outward implementations. The complete map
and placement rules live in `apps/api/README.md`.

Within each role, keep contracts and shared types in a `contracts` module or
subfolder, and group implementations by cohesive responsibility rather than
allowing a single catch-all file to grow indefinitely. Stable entry modules may
compose or re-export internal modules so callers do not depend on internal file
placement. Relative TypeScript imports name `.ts` or `.tsx` explicitly; the
compiler rewrites emitted Node.js imports to `.js`.

The repository quality gate enforces a 1,250-line ceiling for production source
and a 2,500-line ceiling for test source. These are hard
backstops rather than design targets: a module should be split earlier whenever
it combines independently understandable responsibilities.

Do not add barrel files solely to hide paths. Do not extract a workspace
package until there is a demonstrated second consumer, independent deployment
need, or separately owned lifecycle.

## Rationale

Architectural-role-first grouping answers both “what responsibility is this?”
and “which concrete mechanism implements it?” It keeps MongoDB, Redis, memory,
Git, cloud models, and Codex correctly classified as adapters without implying
that their vendor names belong in domain or application contracts.

Executable dependency rules make the structure durable. A diagram or naming
convention alone would not stop a provider contract from drifting back beside
one implementation or an application service from importing infrastructure.

## Consequences

- Imports become longer but expose real ownership and direction.
- Moving a file may touch many imports; such moves should remain mechanical and
  be verified by the complete quality gate.
- New code has a deterministic placement test instead of accumulating in a
  generic root folder.
- Oversized modules and ambiguous or emitted-JavaScript relative imports fail
  the repository quality gate.
- The monolith can add domains and adapters without creating deployment units
  prematurely.
- Later package extraction will follow observed coupling rather than guesswork.

## Alternatives considered

### Group everything by technology

Rejected because a `local-git` folder can implement both read-only context and
repository mutation, which have different ports and authority.

### Group everything only by domain feature

Rejected for this stage because shared persistence and provider adapters span
several use cases and need one visible outward boundary.

### Extract every domain into an npm workspace

Rejected until separate consumers or release/deployment lifecycles justify the
coordination overhead.

### Keep the original flat layer folders

Rejected because they were already becoming search-heavy and encouraged
misclassification as the file count grew.

## Follow-up

- Revisit a workspace extraction when a second app genuinely consumes a stable
  contract.
- Add narrower boundary checks if new adapter directions or runtime processes
  appear.
