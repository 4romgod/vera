# ADR-0006: TypeScript-First npm Monorepo

**Status:** Accepted
**Date:** 24 August 2026
**Decided:** 24 August 2026 (owner) — confirmed deliberately during the
foundation review rather than accepted by default.

## Context

The owner is strongest in the Node/npm ecosystem, can work in Python, and
expects Vera may eventually contain an API, workers, a CLI, web or React Native
clients, shared contracts, and capability adapters.

The project needs a primary language and repository model without preventing a
specialist capability from using a more suitable runtime.

## Proposed decision

Use a monorepo with TypeScript and Node.js as the primary application stack,
managed initially with npm workspaces.

Use TypeScript for Vera's kernel, API, first CLI, shared schemas, and adapters
where it is suitable. Allow Python components behind explicit process or
capability boundaries and manage them with `uv`. Do not adopt Java as a core
runtime without a concrete requirement.

Do not select the exact source folder layout through this ADR.

## Rationale

- It matches the owner's strongest ecosystem.
- API, CLI, web, and React Native clients can share language-neutral generated
  contracts and selected TypeScript utilities.
- The TypeScript ecosystem has strong model, MCP, schema, and streaming support.
- npm workspaces are sufficient before a more advanced task runner proves
  necessary.
- A capability boundary allows Python without making the kernel polyglot.

## Consequences

- One root JavaScript lockfile and pinned package-manager version are expected.
- Workspace boundaries must prevent server code from leaking into clients.
- Cross-process contracts use OpenAPI, JSON Schema, or equivalent stable wire
  formats rather than private TypeScript types.
- Python requires its own pinned runtime, project metadata, and lockfile.
- Task runners, API frameworks, ORMs, and build tools remain separate decisions.

## Alternatives considered

- **Python-first:** credible for AI and data workloads, but weaker for the
  owner's primary ecosystem and shared future clients.
- **Java-first:** rejected absent a JVM-specific requirement.
- **Multiple core languages immediately:** rejected because it adds operational
  and cognitive cost before providing product value.
- **Multiple repositories immediately:** rejected because the expected units
  are initially closely coupled and owned together.

## Evidence required for acceptance

- Confirm the first capability does not depend on a Python-only architecture.
- Spike structured model output and one local-model adapter in TypeScript.
- Confirm expected React Native contract sharing does not require server-only
  dependencies.
- Define deployable and trust boundaries before choosing workspace folders.
