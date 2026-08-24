# Vera

Vera is a proposed personal AI orchestration system: one consistent interface
through which its owner can express intent while Vera selects and coordinates
the appropriate models, tools, workflows, machines, and services.

## Current status

Vera is in discovery and foundation design. No implementation stack, runtime
architecture, or source layout has been approved yet.

The repository is currently the durable source of truth for the project. Chat
history and external source material may inform the project, but decisions only
become authoritative when they are recorded and accepted here.

## Documentation

Start with the [documentation guide](docs/README.md). It provides the reading
order, document authority, status of each design area, and decision index.

The foundation currently covers:

- Vera's product identity and North Star;
- the system architecture and request lifecycle;
- conversations, tasks, runs, events, approvals, and artifacts;
- context, scratchpads, operational state, and long-term memory;
- model providers, specialist capabilities, and external orchestrators;
- security and trust boundaries;
- the proposed V1 proof;
- the architect-builder engineering method;
- proposed architecture decisions awaiting owner review.

Documents and decisions carry their own statuses. A **Proposed** document is a
basis for review, not an approved implementation instruction. Accepted
architecture decisions are indexed under `docs/decisions/`.

## Working method

1. Discover before claiming certainty.
2. Record decisions and unresolved questions explicitly.
3. Define acceptance criteria before implementation.
4. Give builders bounded, repository-backed work rather than relying on chat
   history.
5. Prefer evidence from tests, traces, and inspection over AI agreement.
