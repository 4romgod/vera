# ADR-0029: Publish approved software changes through a separate durable lifecycle

**Status:** Accepted
**Date:** 27 August 2026

## Context

ADR-0017 gives a specialist authority to produce a review-only patch in an
isolated workspace. ADR-0018 gives a separate effect authority to apply and
stage that exact patch in a Vera-managed Git worktree. Neither approval permits
a commit, a remote write, or a pull request.

Leaving publication entirely manual protects the repository but stops Vera
short of completing a useful software-delivery outcome. Folding publication
into either earlier approval would silently widen authority and make recovery
ambiguous: a process can stop after creating a commit, pushing a branch, or
creating a pull request.

## Decision

Vera will publish a successfully staged `SoftwareChangeApplication` through a
new, separately approved, MongoDB-authoritative
`SoftwareChangePublication` lifecycle.

Before approval, Vera freezes and discloses:

- the exact source application identity and version;
- GitHub repository identity and `origin` remote name, without the remote URL;
- immutable staged base commit and current remote base-branch commit;
- Vera-managed head branch, staged Git tree, and complete file manifest;
- configured author identity and exact commit message;
- exact pull-request base, title, body, and draft state; and
- an authority envelope that explicitly forbids direct base pushes and force
  pushes.

The remote base-branch commit must exactly match the immutable commit from
which the managed change was staged. A stale or divergent source is regenerated
before approval rather than publishing a pull request with unrelated ancestry.

The first outbound adapter is `github_gh_cli`. The domain and application
contracts name publication semantics rather than GitHub commands, so another
forge can implement the port later. Server-managed Git and GitHub credentials
remain transport details and are never included in model input, API responses,
or logs. Publication subprocesses receive only the minimal operating-system,
Git transport, and GitHub authentication environment required for their work;
model and storage credentials are not inherited.

After approval, a durable worker takes the same per-project mutation lease used
by change application. Preparation independently verifies every resulting file
byte count and SHA-256 digest against the durable application result. Execution
then validates the frozen Git tree and file manifest,
creates one commit with hooks and GPG signing disabled, creates or verifies the
remote Vera branch without force, and creates or verifies one pull request.
Retries inspect each existing effect. An exact existing commit, branch, or pull
request is success; an incompatible or ambiguous state becomes
`review_required`. The approved base branch is checked both before remote work
and after the pull request is verified; movement requires a fresh publication
review.

Cancellation is permitted only before publication execution begins. Once a
commit or remote effect may have happened, Vera reconciles to a truthful result
instead of claiming rollback.

## Rationale

This creates a tangible end-to-end delivery path without weakening the central
rule that models propose and code controls effects. Separate approval lets the
owner review network and repository authority at the moment it is relevant.
Create-or-verify semantics make process recovery idempotent without destructive
history repair.

## Consequences

- Software delivery now has three explicit authorities: generate, apply, and
  publish.
- Publication requires a credential-free GitHub `origin`, configured Git
  author identity, the `git` executable, and an authenticated GitHub CLI.
- A base branch moving after approval is intentionally inconvenient: the owner
  must create and approve a new publication request against current evidence.
- Vera never updates an existing remote branch or pull request to make it fit an
  approval. It stops for review instead.
- Git hooks are not executed in the managed workspace because repository hooks
  are executable code outside the frozen patch contract.
- Other forges require new adapters and conformance evidence, not changes to
  the aggregate or client contract.

## Alternatives considered

### Keep commit, push, and pull request manual

Safe, but it leaves Vera unable to finish the software task it was asked to
perform and provides no durable audit or recovery path.

### Extend change-application approval to include publication

Rejected because staging and remote publication have materially different
blast radii, credentials, and recovery behavior.

### Let the coding specialist create the pull request

Rejected because it would give a model-controlled subprocess repository
credentials and bypass Vera's exact effect validation.

### Push directly to the base branch

Rejected. V1 publication is review-mediated and create-only.

## Follow-up

- Add provider adapters only when another forge is actually needed.
- Continue visual and physical-device verification of the implemented universal
  frontend delivery surface. It renders the complete authority envelope and
  reconstructs active or successful attempts from durable discovery routes.
- Revisit base-branch movement policy only with evidence that repeated review
  is materially harming delivery.
