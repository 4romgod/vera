# Vera Architecture Decision Records

**Status:** Active index
**Last updated:** 27 August 2026

## Purpose

Architecture Decision Records (ADRs) preserve consequential choices, their
context, alternatives, and consequences. They prevent the project from
re-litigating settled questions without evidence and prevent later edits from
erasing why a choice was made.

## Status meanings

- **Proposed:** recommended and ready for review, but not authoritative.
- **Accepted:** approved and authoritative for its stated scope.
- **Rejected:** evaluated and intentionally not selected.
- **Superseded:** once accepted, but replaced by a later ADR.
- **Deprecated:** still present for compatibility but should not guide new work.

## Decision index

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-vera-is-the-whole-system.md) | Accepted | Vera is the whole assistant system, not a model or framework. |
| [0002](0002-vera-delegates-to-specialist-capabilities.md) | Accepted | Vera is the top-level orchestrator and may invoke specialist orchestrators. |
| [0003](0003-models-propose-code-controls-effects.md) | Accepted | Models provide proposals; application code controls state and side effects. |
| [0004](0004-api-first-client-independent-core.md) | Accepted | Vera begins API-first and clients do not own core semantics. |
| [0005](0005-isolate-independent-streams-of-work.md) | Accepted | Independent work has explicit identity and isolated state/context. |
| [0006](0006-typescript-first-npm-monorepo.md) | Accepted | Use a TypeScript/Node-first monorepo managed initially with npm workspaces. |
| [0007](0007-separate-durable-state-from-model-context.md) | Accepted | Separate authoritative durable state, rebuildable execution scratchpad, and disposable model context without selecting a storage product. |
| [0008](0008-trim-v1-scope-and-ratify-foundation.md) | Accepted | Ratify the foundation review and trim V1 scope to a solo-buildable slice. |
| [0009](0009-implement-the-model-decision-boundary.md) | Accepted | Implement the first production decision boundary as a Fastify/Zod modular TypeScript API with Ollama and deterministic adapters. |
| [0010](0010-use-mongodb-for-operational-truth-and-redis-for-scratchpads.md) | Accepted | Use MongoDB for authoritative V1 task aggregates and Redis for rebuildable, expiring run scratchpads. |
| [0011](0011-use-generic-project-sources-and-bounded-context-snapshots.md) | Accepted | Represent projects generically and disclose only bounded, approved, hash-verified context snapshots to specialists. |
| [0012](0012-late-bind-specialist-platforms-behind-capability-adapters.md) | Accepted | Keep capability semantics provider-neutral and late-bind explicit, auditable specialist adapters. |
| [0013](0013-dispatch-durable-work-with-mongodb-leases.md) | Accepted | Derive asynchronous work from MongoDB state and coordinate workers with expiring per-run MongoDB leases. |
| [0014](0014-use-the-host-session-as-the-v1-owner-boundary.md) | Accepted | Use the authenticated host/SSH session and a code-enforced loopback listener as V1's single-owner perimeter. |
| [0015](0015-select-model-providers-through-explicit-profiles.md) | Accepted | Select Ollama, OpenAI, or Gemini through explicit startup profiles without silent cross-boundary fallback. |
| [0016](0016-freeze-bounded-conversation-context-and-durably-project-replies.md) | Accepted | Freeze bounded prior same-scope complete turns and recover every terminal Vera reply through a durable projection. |
| [0017](0017-produce-software-changes-as-isolated-patch-artifacts.md) | Accepted | Produce software changes as isolated, review-only patch artifacts without mutating or publishing the registered project. |
| [0018](0018-apply-approved-software-changes-in-managed-git-worktrees.md) | Accepted | Apply exact approved patch artifacts into durable managed Git worktrees without commit or publication authority. |
| [0019](0019-organize-the-api-as-an-inward-dependent-modular-monolith.md) | Accepted | Organize the growing API by architectural role and cohesive responsibility, enforced by dependency tests. |
| [0020](0020-use-a-declarative-capability-runtime-and-approval-gated-web-research.md) | Accepted | Route enabled specialists through one declarative runtime and add project-independent, approval-gated web research. |
| [0021](0021-execute-bounded-goals-with-step-scoped-approvals-and-artifact-lineage.md) | Accepted | Execute two- or three-step goals through separate approvals and integrity-checked artifact handoffs. |
| [0022](0022-introduce-provider-neutral-integration-actions-with-vera-owned-personal-tasks.md) | Accepted | Add a provider-neutral integration-action boundary and durable, approval-gated personal tasks. |
| [0023](0023-deliver-durable-reminders-through-a-vera-owned-notification-inbox.md) | Accepted | Schedule restart-safe reminders and atomically deliver them to a durable, cursor-addressable Vera inbox. |
| [0024](0024-adapt-bounded-goals-from-validated-capability-evidence.md) | Accepted | Let bounded goals choose one next approved step or finish after validating durable capability evidence. |
| [0025](0025-use-explicit-versioned-owner-governed-memory.md) | Accepted | Retain only explicit, approved, versioned owner memory and disclose bounded verified context only to owner-controlled brains. |
| [0026](0026-use-one-expo-react-native-frontend-for-web-and-mobile.md) | Accepted | Use one Expo React Native workspace for Vera's web, iOS, and Android experience. |
| [0027](0027-use-tailscale-serve-for-private-physical-device-access.md) | Accepted | Keep Vera loopback-only and use private Tailscale Serve ingress for physical devices. |
| [0028](0028-treat-device-voice-as-a-reviewed-experience-adapter.md) | Superseded | Original device-recognition approach; capture and transcription are replaced by ADR-0030. |
| [0029](0029-publish-approved-software-changes-through-a-separate-durable-lifecycle.md) | Accepted | Commit, push a Vera branch, and create a pull request through a separate exact approval and recoverable publication lifecycle. |
| [0030](0030-transcribe-owner-controlled-recordings-through-a-provider-neutral-boundary.md) | Accepted | Record until the owner stops, then transcribe once through an ephemeral provider-neutral API boundary. |
| [0031](0031-store-owner-attachments-and-analyze-them-through-exact-approval.md) | Accepted | Store owner-scoped documents and images durably and disclose bounded derived content only through exact, provider-aware approval. |
| [0032](0032-compose-attachment-evidence-into-separately-approved-actions.md) | Accepted | Turn attachment evidence into later actions through bounded adaptive goals, explicit evidence classes, and separate approvals. |
| [0033](0033-govern-machine-operations-through-registered-actions.md) | Accepted | Inspect and control exact registered services through machine-specific approvals, local/SSH adapters, and verified postconditions. |

ADRs 0001–0008 were accepted 24 August 2026 following the owner's review of
the foundation documentation. ADR-0007 accepted a semantic boundary without
selecting products at that time. ADR-0009 records the owner-directed start of
implementation and the first executable vertical slice. ADR-0010 resolves the
storage decision: MongoDB is authoritative and Redis is a rebuildable
projection. ADR-0010 records the required real-process recovery evidence; that
behavior remains a regression criterion, not an undecided product choice.
ADR-0011 ensures the first real project remains acceptance data rather than a
hard-coded architectural dependency.
ADR-0012 makes Codex the first registered planning adapter rather than a
permanent capability or domain dependency.
ADR-0013 makes `202 Accepted` genuinely asynchronous without turning Redis or
an in-process promise into execution authority.
ADR-0014 resolves V1's owner-boundary contradiction without claiming that
loopback itself authenticates HTTP callers. ADR-0015 makes the model gateway
operationally interchangeable while preserving provider-specific privacy,
credentials, readiness, and failure behavior. ADR-0016 turns conversations into
bounded multi-turn model context and complete durable dialogue without treating
history as authority or long-term memory.
ADR-0017 adds the first implementation capability while separating disposable
workspace writes from repository mutation, commits, pushes, and pull requests.
ADR-0018 adds repository mutation as a separate, exactly approved and
recoverable managed-worktree effect while continuing to exclude commits and
publication. ADR-0019 makes the API's role-first nested module map explicit and
executable without prematurely splitting the modular monolith. ADR-0020 makes
capability availability, authority, routing, and execution one declarative
runtime fact and proves the boundary with project-independent web research.
ADR-0021 turns those declarative capabilities into bounded assistant-level goal
execution without introducing an unbounded model loop or blanket approval.
ADR-0022 adds the first owner-state integration through per-action authority,
durable personal tasks, and a provider-neutral adapter port without selecting an
external task vendor.
ADR-0023 adds time-triggered assistant behavior through MongoDB-authoritative
reminders, expiring delivery claims, atomic inbox notifications, and resumable
SSE projection without making Redis or a client connection authoritative.
ADR-0024 adds a durable observe-decide-act boundary for evidence-dependent
goals while retaining exact approval, finite budgets, provider-neutral
capabilities, and owner-controlled artifact disclosure.
ADR-0025 adds explicit long-term personalization through approval-gated,
versioned memory and integrity-checked provider-bound context. ADR-0026 makes
the resulting assistant usable through one Expo React Native frontend for web,
iOS, and Android while preserving the API-first, client-independent core.
ADR-0027 extends the single-owner deployment perimeter to private physical
devices through Tailscale Serve without rebinding Vera or enabling public
Funnel access. ADR-0028's device recognizer was superseded after physical
testing. ADR-0030 keeps voice inside the universal experience plane while
making capture owner-controlled and transcription a provider-neutral,
non-durable server boundary; spoken replies still follow durable projection.
ADR-0029 completes the controlled software-delivery path with one exact commit,
a create-only Vera branch push, and one exact pull request behind a separate
durable approval and retry reconciliation boundary.
ADR-0031 adds durable document and image intelligence without treating uploads as prompts:
immutable owner-scoped attachments, integrity-checked derived representations, minimal
orchestration metadata, exact disclosure approval, and cited analysis
artifacts.
ADR-0032 makes attachment intelligence actionable without widening the first
approval: Vera understands the attachment, derives one bounded next action,
then asks again while distinguishing decision evidence from artifact content
that the destination will receive.
ADR-0033 adds the first governed machine operations without introducing a
general shell: catalogs freeze operator-selected commands, inspection and
mutation remain separate approvals, and durable artifacts prove postconditions.

## ADR rules

- Accepted ADRs are not silently rewritten when a decision changes.
- A replacement ADR names the record it supersedes and describes migration.
- Minor wording corrections may be made without changing meaning.
- ADRs decide one coherent issue; detailed specifications live elsewhere.
- A decision may intentionally defer implementation details.

## Template

```markdown
# ADR-NNNN: Decision title

**Status:** Proposed | Accepted | Rejected | Superseded | Deprecated
**Date:** YYYY-MM-DD

## Context

What problem or forces require a decision?

## Decision

What is being decided?

## Rationale

Why is this option preferred?

## Consequences

What becomes easier, harder, required, or forbidden?

## Alternatives considered

What credible alternatives were evaluated?

## Follow-up

What remains to be specified or validated?
```
