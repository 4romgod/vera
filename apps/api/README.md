# Vera API module map

The API is a modular monolith. Its folders describe architectural roles, not
deployment units or arbitrary file categories.

```text
src/
├── adapters/
│   ├── inbound/
│   │   └── http/                    # Fastify transport and HTTP schemas
│   └── outbound/
│       ├── capabilities/            # Codex/model/deterministic capability implementations
│       ├── change-applications/     # Managed Git effect implementation
│       ├── integrations/            # Provider-neutral owner-service actions
│       ├── model/                   # Ollama/OpenAI/Gemini/deterministic model implementations
│       ├── notifications/           # Notification delivery implementations
│       ├── persistence/
│       │   ├── memory/              # In-process port implementations for tests/local mode
│       │   ├── mongodb/             # Durable stores, leases, validators, migrations
│       │   └── redis/               # Rebuildable scratchpad implementation
│       └── project-context/         # Read-only project-source implementation
├── application/                     # Use cases and lifecycle coordination
│   ├── artifacts/
│   ├── capabilities/                # Owner-visible runtime catalog
│   ├── change-applications/
│   ├── conversations/
│   ├── model-decisions/
│   ├── projects/
│   ├── reminders/                   # Reminder queries, inbox, and scheduler
│   ├── shared/
│   └── tasks/
├── bootstrap/                       # Environment, configuration, composition, process startup
├── domain/                          # Versioned business concepts and invariants
├── ports/                           # Provider-neutral boundaries required by the application
└── server.ts                        # Stable process entry point; delegates to bootstrap
```

## Placement rules

- `domain` contains no imports from application, ports, adapters, or bootstrap.
- `ports` describe what the core requires and depend only on domain contracts
  or other ports.
- `application` coordinates use cases through ports. It does not instantiate or
  import infrastructure implementations.
- `adapters/inbound` translate external requests into application calls.
- `adapters/outbound` implement ports for databases, model providers,
  specialists, Git, and other external mechanisms.
- `bootstrap` is the composition root. It is the only role allowed to select
  concrete adapters from runtime configuration and wire the complete process.
- Capability declarations live in `domain/capabilities`, the generic runtime
  port in `ports/capabilities`, and provider-specific registrations under
  `adapters/outbound/capabilities`. The shared task lifecycle depends only on
  the runtime port and must not branch on capability or provider names.
- Tests mirror source roles where practical. Cross-boundary journeys live in
  `test/journeys`, and reusable test doubles live in `test/support`.

The architecture test in
`test/architecture/module-boundaries.test.ts` enforces the inward dependency
direction and the allowed top-level source roles.

## When to add a folder or package

Create a second-level folder when several files share one stable domain, use
case, boundary, or implementation mechanism. Do not create a folder merely to
hold one incidental helper; place the helper with the behavior it supports.

Keep a new module inside `apps/api` until it has a real second consumer,
independent deployment need, or separately owned lifecycle. Only then consider
extracting it to `packages/*` or another app. Folder boundaries are not a claim
that Vera already needs microservices.

Avoid barrel files whose only purpose is to shorten imports. Direct imports
make dependencies and ownership visible during refactoring.
