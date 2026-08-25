# ADR-0015: Select model providers through explicit profiles

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera's domain already depends on a provider-neutral model gateway, but runtime
configuration and wiring selected only Ollama or the deterministic test
provider. The owner needs to switch between a local Ollama model and cloud
providers such as OpenAI or Gemini without changing orchestration, persistence,
approval, capability, or client code.

Provider configuration includes secrets and different data boundaries. An
implicit fallback from a local model to a cloud API could disclose owner intent
or create cost without a deliberate decision. A generic environment name such
as `ENV` would also conflate model choice with future deployment environments.

## Decision

Vera selects one model provider when the process starts through
`VERA_MODEL_PROVIDER`. The implemented registry contains `ollama`, `openai`,
`gemini`, and the non-production `deterministic` provider. Each real adapter
implements the same model-provider port and owns only its external transport,
structured-output conversion, readiness, error normalization, and usage
metadata.

Provider-specific settings may be isolated in a named file selected with
`VERA_PROFILE`:

```bash
VERA_PROFILE=openai npm run dev
```

The selected file is `.env.<profile>`. The shared file remains `.env`.
Precedence is:

1. variables already present in the launching shell;
2. `.env.<profile>`; and
3. `.env`.

Profile names are normalized to lowercase and restricted to letters, numbers,
underscores, and hyphens. Selecting a missing or unsafe profile fails startup.
Actual `.env` and `.env.*` files are ignored; only example templates are
committed.

Ollama and deterministic providers are `owner_controlled`. OpenAI and Gemini
are `third_party`. Selecting a cloud profile is the owner's startup-level
authorization to send the owner message and minimal selected-project identity
to that provider for orchestration. It does not authorize repository contents,
credentials, unrelated memory, or capability execution. A cloud-backed
`structured_model` capability still requires the exact existing disclosure
approval before its hash-bound project context is sent.

ADR-0016 later extends the orchestration disclosure to bounded prior complete
turns from the exact same scope; it does not change this decision's no-fallback,
credential, repository-content, or capability-approval boundaries.

There is no automatic provider fallback. A failed or unavailable configured
provider produces a classified failure. Switching providers on restart does
not redirect an already approved capability invocation to a different
destination; frozen approval identity continues to fail closed if its adapter
cannot be resolved.

API keys remain process configuration. They are passed only in provider
transport headers and must never be logged, persisted, placed in prompts, or
returned to clients. Cloud-provider base URLs must use HTTPS and cannot embed
credentials, queries, or fragments. Readiness verifies credentials and model
access without performing paid inference. Every provider request has a timeout
and a configured maximum output-token request. Provider output is still
validated by Vera's authoritative Zod schema after provider-native structured
generation.

## Rationale

Startup-scoped selection is predictable, operable, and sufficient for the
single-owner V1. Profiles make local switching convenient without turning
secrets into repository state. A registry and common conformance behavior prove
that provider payloads do not enter Vera's domain while preserving truthful
differences in privacy, readiness, and usage.

## Consequences

- Changing Ollama, OpenAI, or Gemini requires configuration and restart, not
  domain or API changes.
- Adding a provider requires a deliberate adapter, configuration schema,
  boundary classification, and conformance tests; an arbitrary API key cannot
  make incompatible protocols interchangeable.
- Cloud profiles disclose owner messages to the named provider and may incur
  usage cost.
- Shell variables can override a profile for temporary changes without editing
  secret files.
- Provider model aliases remain operator-configurable because availability
  differs by account and changes over time.
- Per-task model routing, automatic failover, provider pools, and quality/cost
  routing remain later capabilities requiring explicit policy.

## Alternatives considered

### Replace Ollama with one cloud SDK in application code

Rejected because it would exchange one hard dependency for another and allow
provider types to leak into the orchestration core.

### Automatically try providers in order

Rejected because provider failure would silently change disclosure and cost
boundaries. Any future fallback must be policy-visible and boundary-safe.

### One universal HTTP adapter for every AI API

Rejected because provider authentication, schema dialects, response shapes,
readiness, errors, and token metadata are materially different. Compatibility
must be proven by an adapter, not assumed from similar marketing language.

### Use `ENV=openai`

Rejected because provider choice is not the same concern as development,
staging, or production deployment. `VERA_PROFILE` names a Vera configuration
profile without occupying a generic environment variable.

## Follow-up

- Run real conformance with owner-supplied OpenAI and Gemini keys.
- Add cumulative token or monetary accounting before permitting multiple cloud
  model calls per run.
- Introduce per-task routing or fallback only with explicit data-boundary and
  budget policy.
