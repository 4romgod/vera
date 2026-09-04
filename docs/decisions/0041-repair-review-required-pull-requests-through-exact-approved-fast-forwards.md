# ADR-0041: Repair review-required pull requests through exact approved fast-forwards

**Status:** Accepted
**Date:** 4 September 2026

## Context

Development campaigns and missions can publish a correct, locally verified pull
request and later encounter a failed hosted check or an actionable reviewer
change request. ADR-0034 intentionally stopped at `review_required` because
Vera did not yet have a safe way to turn remote evidence into new coding work
or update an existing branch.

Leaving every such pull request to manual repair prevents Vera from completing
useful software work while its owner is away. Automatically treating review
text or CI output as instructions would be unsafe: both are untrusted input,
the pull-request head can race, and updating a branch is a new remote effect.

## Decision

Vera may prepare a bounded pull-request repair approval only when an existing
campaign is `review_required` because the exact open pull request has failed
checks or a `CHANGES_REQUESTED` review decision and its approved attempt ceiling
has not been exhausted.

Preparation re-observes GitHub and freezes:

- the exact pull-request number, URL, head commit, and approved base commit;
- bounded failed-check summaries and review comments as untrusted evidence;
- one derived repair objective and ticket;
- the existing specialist destination and application limits;
- configured local quality gates;
- one exact commit message and author; and
- authority to fast-forward only the existing pull-request branch.

The owner approves or rejects that exact repair separately. Approval does not
grant force-push, base-branch push, merge, policy mutation, or authority derived
from the evidence. The coding specialist receives project context assembled
from the frozen PR head, not the registered checkout's current `HEAD`.

After the exact generated patch is staged and all configured local gates pass,
application code verifies that the remote branch still equals the approved
source commit, creates or recovers one exact repair commit, and performs a
normal non-forced push. Vera confirms that the same pull request now points at
that commit and returns to check/review observation. Every attempt, approval,
evidence snapshot, commit transition, and result remains durable.

Mission-owned campaigns use the same owner-controlled repair approval. A
mission remains executing while its campaign waits for review or repair and can
complete only after the repaired campaign reaches a verified pull request. The
mission's permanent no-merge boundary remains unchanged.

## Rationale

An exact approval keeps the owner in control of new evidence and a new remote
effect. Anchoring context, application, commit parent, remote compare-and-set,
and PR verification to one immutable head prevents a repair from silently
targeting different code. A normal fast-forward push uses Git's existing
concurrency protection and preserves review history.

This is more useful than abandoning the campaign, while remaining materially
narrower than giving a coding tool GitHub credentials or an open-ended loop.

## Consequences

- Hosted failures and reviewer requests can be repaired on the existing PR.
- Repair consumes the campaign's original finite attempt budget.
- GitHub evidence must be bounded, sanitized, persisted, and labelled untrusted.
- Historical-commit project-context assembly becomes a required capability.
- A moved head/base, closed PR, exhausted budget, failed local repair gate, or
  non-fast-forward push fails closed for another owner decision.
- The publication lifecycle remains create-or-verify only; branch updates belong
  to this separately approved campaign repair effect.
- Missions still never merge pull requests.

## Alternatives considered

- **Always stop permanently at remote failure.** Safe but too limited for a
  useful autonomous assistant.
- **Automatically retry from live GitHub state.** Rejected because evidence is
  untrusted and the authority/race boundary would be implicit.
- **Force-push a replacement branch.** Rejected because it rewrites reviewed
  history and defeats safe compare-and-set behavior.
- **Create a new pull request for each repair.** Rejected because it fragments
  review context and does not model the requested repair of the existing PR.
- **Give the coding provider GitHub credentials.** Rejected because it merges
  proposal and effect authority and makes provider replacement less safe.

## Follow-up

- Add richer provider-neutral adapters for hosted check logs where platforms
  expose them safely.
- Add an owner-configured repair-attempt ceiling separate from the campaign
  ceiling only if real usage demonstrates the need.
- Add sandboxing before campaigns execute code from untrusted contributors.
