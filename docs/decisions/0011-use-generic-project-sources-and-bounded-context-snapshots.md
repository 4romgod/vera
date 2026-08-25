# ADR-0011: Use generic project sources and bounded context snapshots

**Status:** Accepted
**Date:** 24 August 2026

## Context

Vera's first repository-aware journey needs a real project for acceptance, but
Vera is intended to orchestrate work for every project its owner may use and,
later, projects owned by other authenticated principals. Encoding the first
acceptance project into task routing, storage, or capability contracts would
turn a test case into permanent product architecture.

The planning capability also crosses a trust boundary. A model-generated path
cannot be authority to read the local filesystem, and allowing a specialist to
inspect an entire repository after approval would make the approval inaccurate.

## Decision

Vera represents a project with a stable `projectId`, owning `principalId`, and
a versioned source descriptor. The first source kind is `local_git`; future
source adapters may add GitHub, GitLab, or remote workspaces without changing
task, approval, capability, or artifact identity.

Project registration is an explicit owner-controlled operation. Tasks and
messages refer to a registered `projectId`. Model proposals may describe a
project, but cannot create a project, choose a filesystem path, or grant access.

Before approval, Vera's local source adapter creates a bounded context bundle:

- a manifest containing project identity, revision, selected relative paths,
  classifications, reasons, hashes, sizes, exclusions, and enforced limits;
- the exact source contents corresponding to that manifest; and
- no untracked files, environment files, credential-like paths, dependency or
  build directories, agent instruction files, binaries, symlinks, or paths
  escaping the registered Git root.

Selection is deterministic and local. Exact request anchors such as an API
route take precedence. When one resolves, broad prose tokens cannot admit
unrelated paths or distort ordering within the anchored evidence set. Without
an anchor, token-boundary path matches and fixed-string content matches
establish relevance. Source code, relevant tests, and configuration rank above
documentation. Nearby evidence is limited to non-documentation files in the
same directory as directly matched implementation evidence; broad ancestor or
test-directory expansion is not allowed. If nothing matches, only
repository-root evidence is selected; Vera does not fill the remaining budget
with arbitrary source. Unless documentation is the request's primary intent,
it may consume at most one fifth of both the file-count and byte budgets. A
request to implement and then document a change remains implementation work.
Small, tracked repository-root formatter configurations are included as
verification evidence. Full-text discovery does not cross a provider boundary:
only the final manifest and hash-verified selected contents can be approved for
disclosure.

The approval discloses the manifest and exact selected specialist destination.
For the default `codex_cli` adapter, approval is followed by reconstruction of
only those hash-verified documents in an ephemeral snapshot and invocation of
`codex exec` with `--ephemeral` and a read-only sandbox. Codex cannot discover
more local project context through this contract.

An explicit model-backed conformance adapter may instead declare a local model
destination. The approval records that actual adapter destination; it must
never label local execution as Codex or cloud disclosure.
The provider-neutral adapter identity and substitution rule are formalized in
[ADR-0012](0012-late-bind-specialist-platforms-behind-capability-adapters.md).

The successful plan is persisted as one versioned `implementation_plan`
artifact. The capability invocation ID is its idempotency identity. Projects,
conversations, tasks, approvals, and artifacts are principal-scoped; task
request idempotency is the compound identity `(principalId, requestKey)`.

Gatherle is a manual acceptance project, not a production special case. A
project name in production routing, storage logic, or capability contracts is
a design defect unless it is user-owned data.

## Rationale

Stable project identity separates user intent from source location. A source
adapter makes local Git an implementation choice rather than the definition of
a project. Freezing and hashing selected context makes approval meaningful,
supports recovery, prevents time-of-check/time-of-use drift, and creates a
testable boundary around cloud disclosure.

Principal-scoped identities cost little in the single-owner system and avoid a
known multi-user migration trap without prematurely implementing SaaS tenancy.

## Consequences

- A repository must be explicitly registered before repository-aware work.
- Planning requests must identify the project by `projectId`.
- Local context selection is deterministic, bounded, and more conservative
  than unrestricted repository search; missing evidence must be reported.
- Exact request anchors and token boundaries prevent generic substrings from
  admitting unrelated files, while separate documentation limits prevent
  historical prose from crowding implementation evidence out of the snapshot.
- Approved context is stored with the task aggregate so recovery can reproduce
  the invocation exactly.
- MongoDB maintains separate project, conversation, and artifact resources in
  addition to task execution aggregates.
- Context limits and source-selection rules are code policy, not prompt advice.
- Supporting another source requires a new adapter and source schema variant,
  not changes to planning semantics.

## Alternatives considered

### Hard-code the first project

Rejected because it confuses acceptance data with product architecture and
cannot support additional projects without code changes.

### Let Codex inspect the registered repository directly

Rejected because the approval could not truthfully enumerate disclosed data,
and the capability would receive broader filesystem authority than required.

### Put arbitrary repository paths in model proposals

Rejected because model output is untrusted proposed data, not filesystem
authority.

### Send the entire tracked repository

Rejected because repositories routinely exceed useful context limits and may
contain unrelated or sensitive tracked material.

## Follow-up

- Add authenticated principal derivation before any non-loopback deployment.
- Add source adapters only when a concrete project requires them.
- Refine deterministic context ranking with evidence from real plans while
  keeping the manifest and security invariants stable.
- Automate the existing deterministic interrupted-run recovery checks and
  compiled persistent restart smoke journey in a CI-capable integration harness.
- Preserve the owner-reviewed exact-manifest approval proven with real Codex on
  25 August 2026; the application must never self-approve that disclosure.
