# Vera HTTP API

**Status:** Accepted for implemented V1 paths
**Version:** 0.6
**Last updated:** 25 August 2026

## Purpose

This document owns the external behavior of Vera's implemented HTTP paths. The
domain meanings remain in the [Domain Model](domain-model.md); this document
defines how an HTTP client observes them.

All paths are versioned except process health. JSON request objects are closed:
unknown properties are rejected rather than silently removed. The service
rejects non-loopback bind configuration and uses the implicit `owner_v1`
principal inside the trusted Mac Mini account/SSH perimeter. This topology does
not provide application-layer caller authentication and must not be exposed to
an untrusted network.

## Implemented paths

| Method and path | Purpose | Success |
|---|---|---:|
| `GET /health` | Process liveness only | `200` |
| `GET /ready` | Model, stores, recovery, planning, and software-change readiness | `200` or `503` |
| `POST /v1/projects` | Register an owner-controlled project source | `201` |
| `GET /v1/projects` | List registered projects | `200` |
| `GET /v1/projects/{projectId}` | Retrieve a registered project | `200` |
| `POST /v1/conversations` | Create a conversation | `201` |
| `GET /v1/conversations` | List conversations | `200` |
| `GET /v1/conversations/{conversationId}` | Retrieve messages and task links | `200` |
| `POST /v1/conversations/{conversationId}/messages` | Add owner intent and create its task | `202` |
| `POST /v1/tasks` | Submit owner intent as a durable task and first run | `202` |
| `GET /v1/tasks/{taskId}` | Retrieve the current task/run projection | `200` |
| `GET /v1/runs/{runId}` | Retrieve the current task/run projection by run | `200` |
| `GET /v1/runs/{runId}/events` | Retrieve immutable ordered run events | `200` |
| `POST /v1/approvals/{approvalId}/decision` | Approve or reject the exact proposed invocation | `202` |
| `POST /v1/runs/{runId}/cancellation` | Request a best-effort stop | `202` |
| `GET /v1/artifacts/{artifactId}` | Retrieve a versioned capability artifact | `200` |
| `POST /v1/model-decisions` | Exercise the lower-level model decision boundary | `200` |

The model-decision path is useful for provider and proposal diagnostics. New
owner-facing clients should submit tasks so accepted work has durable identity,
events, approval, and recovery semantics.

## Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> deciding: durable task created
    deciding --> succeeded: direct response
    deciding --> rejected: proposal rejected
    deciding --> failed: model or internal failure
    deciding --> awaiting_approval: capability proposed
    awaiting_approval --> rejected: owner rejects
    awaiting_approval --> cancelled: owner cancels
    awaiting_approval --> executing: owner approves and execution claim succeeds
    executing --> cancellation_requested: owner requests cancellation
    cancellation_requested --> cancelled: capability stops
    cancellation_requested --> succeeded: capability finishes first
    executing --> succeeded: validated result recorded
    executing --> failed: capability fails
```

Task status is a coarser projection:

| Run status | Task status |
|---|---|
| `deciding`, `awaiting_approval`, `executing`, `cancellation_requested` | `active` |
| `succeeded` | `completed` |
| `rejected` | `rejected` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

Terminal runs are not reopened. Retry as a new run is not implemented yet.

## Submit a task

```http
POST /v1/tasks
Content-Type: application/json
Idempotency-Key: 4a43628a-e1df-42f7-98bb-b2e59b62745d

{
  "message": "Create an implementation plan for VERA-202.",
  "projectId": "project_..."
}
```

`Idempotency-Key` is required, case-insensitive as an HTTP header, and must be
8–200 characters. The key is scoped to the implicit V1 principal. Repeating the
same key with the same complete task input returns the original task. Reusing
it for different input returns `409 idempotency_key_reused`. Different
principals may independently use the same key.

Vera persists the task before asking a model. A worker then discovers the
`deciding` run from durable state. A provider failure therefore
produces an inspectable terminal task instead of losing the accepted request.
The response is `202 Accepted` because clients must treat task resources and
polling—not the duration of this connection—as the execution contract.

The initial response will normally have `runStatus: "deciding"`. Clients must
poll `GET /v1/runs/{runId}` until the run becomes terminal or reaches
`awaiting_approval`; they must not assume the submission response already
contains an approval.

Example waiting response, abbreviated:

```json
{
  "schemaVersion": 1,
  "taskId": "task_...",
  "runId": "run_...",
  "taskStatus": "active",
  "runStatus": "awaiting_approval",
  "message": "Create an implementation plan for VERA-202.",
  "projectId": "project_...",
  "approval": {
    "id": "approval_...",
    "status": "pending",
    "reason": "specialist_capability_invocation",
    "capability": {
      "name": "development_planning",
      "version": 1
    },
    "proposedArguments": {
      "objective": "Create an implementation plan for VERA-202.",
      "ticket": {
        "reference": "VERA-202",
        "details": "Create an implementation plan."
      },
      "project": {
        "name": "Vera"
      }
    },
    "project": {
      "id": "project_...",
      "displayName": "Vera"
    },
    "contextManifest": {
      "schemaVersion": 1,
      "projectId": "project_...",
      "sourceKind": "local_git",
      "revision": "<git-commit>+working-tree",
      "entries": [
        {
          "relativePath": "apps/api/src/server.ts",
          "sha256": "...",
          "bytes": 1234,
          "selectionReason": "Repository evidence for the requested work.",
          "classification": "source_code"
        }
      ],
      "totalFiles": 1,
      "totalBytes": 1234
    },
    "destination": {
      "schemaVersion": 1,
      "adapterId": "codex_cli",
      "provider": "openai",
      "transport": "local_process",
      "dataBoundary": "third_party"
    },
    "requestedAt": "2026-08-24T18:00:00.000Z"
  },
  "links": {
    "task": "/v1/tasks/task_...",
    "run": "/v1/runs/run_...",
    "events": "/v1/runs/run_.../events",
    "approval": "/v1/approvals/approval_.../decision"
  }
}
```

`proposedArguments` is the model-proposed routing input. `project`,
`contextManifest`, destination, invocation identity, and limits are
authoritative fields added by Vera code. Approval covers this complete
disclosure. The corresponding hash-verified contents are frozen durably but are
not echoed in ordinary API responses.

The destination is provider-neutral but not anonymous. A future
`claude_code_cli` adapter would appear as that `adapterId` with provider
`anthropic`; it would not require a different task or artifact contract.
The claimed invocation and resulting artifact copy this descriptor. Execution
resolves the persisted approved descriptor, not whichever adapter happens to be
selected when an approval or restart is processed. If the adapter is absent or
its provider/boundary configuration changed, the run fails closed.

In a completed development plan or software change, `project`, `ticket`, and `objective` are copied
into the result by Vera code from these approved arguments. They are deliberately
excluded from model-generated plan content, so a model cannot rewrite task
identity while producing the plan.

## Decide an approval

```http
POST /v1/approvals/approval_.../decision
Content-Type: application/json

{
  "decision": "approved"
}
```

The only decisions are `approved` and `rejected`. Vera records the decision and
principal before doing anything else. On approval it then atomically claims an
invocation identity before calling the capability.

Repeating the same decision is idempotent. Sending the opposite decision after
one has been recorded returns `409 approval_already_decided`. A model, caller
request property, or capability cannot create or broaden an approval.

## Register projects and use conversations

Project registration is explicit and idempotent:

```http
POST /v1/projects
Content-Type: application/json
Idempotency-Key: register-vera-local

{
  "displayName": "Vera",
  "source": {
    "kind": "local_git",
    "rootPath": "/absolute/path/to/vera"
  }
}
```

The path must be the canonical root of a Git repository. Models never provide
or alter it. A conversation is created with `POST /v1/conversations`, then an
owner message creates a linked task:

```http
POST /v1/conversations/conversation_.../messages
Content-Type: application/json
Idempotency-Key: plan-vera-202

{
  "content": "Prepare the implementation plan for VERA-202.",
  "projectId": "project_..."
}
```

Repeating the message key returns the same message and task. A single
conversation response exposes immutable owner and Vera messages and their
`taskId` links. Before the model call, the task freezes bounded prior complete
turns from the exact same `projectId` scope; unscoped messages form their own
scope. The task response exposes `conversationContextManifest` with hashes,
limits, totals, and exclusion counts, without duplicating message content.

Every terminal conversation task has a `conversationReply` projection with a
stable message ID and `pending` or `projected` status. The worker recovers a
pending projection idempotently. A polling client should treat a conversation
task as settled only after this status is `projected`, even if the run has
already reached a terminal status.

The list endpoint returns bounded summaries instead: identity, title, status,
timestamps, `messageCount`, and the most recent message without its internal
idempotency key.

## Artifacts and cancellation

A successful planning invocation stores one `implementation_plan` artifact. A
successful `software_change@1` invocation stores one `software_change` artifact
with a reviewable Git patch, file operations, sizes, hashes, verification
report, and risks. The change is produced in an isolated snapshot and does not
modify, commit, push, or publish the registered project.

The stable artifact identity is derived from the invocation ID; retry or
recovery cannot create a second artifact for that invocation. The task output
includes a typed artifact reference, and
`GET /v1/artifacts/{artifactId}` returns the versioned content and provenance.

`POST /v1/runs/{runId}/cancellation` records a stop request. Before capability
execution it terminally cancels the run and rejects a pending approval. During
execution it asks the adapter to abort. Cancellation is best effort: a
capability that finishes before the abort is observed may still succeed.

The cancellation and approval handlers also return after their durable
transition. The worker performs subsequent execution asynchronously, so clients
poll the run resource for the resulting terminal state. No long-running work
depends on one HTTP connection.

## Events

`GET /v1/runs/{runId}/events` returns:

```json
{
  "schemaVersion": 1,
  "taskId": "task_...",
  "runId": "run_...",
  "events": []
}
```

Every event has an opaque ID, a strictly increasing sequence within the task
aggregate, a stable type, an ISO-8601 occurrence time, and a versioned payload
owned by that event type. Current event types are:

- `task_created`, `run_started`;
- `budget_assigned`, `budget_consumed`, `budget_exhausted`;
- `model_decision_recorded`;
- `context_assembled`;
- `approval_requested`, `approval_approved`, `approval_rejected`;
- `capability_invocation_started`, `capability_invocation_succeeded`,
  `capability_invocation_failed`;
- `artifact_created`;
- `cancellation_requested`, `run_cancelled`;
- `run_succeeded`, `run_rejected`, `run_failed`;
- `conversation_context_assembled`, `conversation_reply_pending`,
  `conversation_reply_projected`.

Events are evidence, not debug logs. Provider internals, credentials, and raw
exceptions are excluded.

## Validation and errors

Error envelopes use:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Request validation failed."
  }
}
```

| Status | Codes | Meaning |
|---:|---|---|
| `400` | `invalid_request` | Missing, malformed, too large, or unknown request input. |
| `404` | `task_not_found`, `run_not_found`, `approval_not_found`, `project_not_found`, `conversation_not_found`, `conversation_message_not_found`, `artifact_not_found` | The addressed resource does not exist. |
| `409` | `idempotency_key_reused`, `approval_already_decided`, `concurrent_transition_failed`, `conversation_message_mismatch` | The request conflicts with durable state. |
| `422` | `invalid_project_source` | A project path is not a canonical local Git root. |
| `502` | `provider_request_rejected`, `provider_response_invalid` | Provider boundary failed while using the diagnostic endpoint. |
| `503` | `model_not_found`, `provider_unavailable`, `operational_store_unavailable`, `scratchpad_unavailable`, `planning_capability_unavailable`, `software_change_capability_unavailable` | A required runtime dependency is unavailable. |
| `504` | `provider_timeout` | The model provider exceeded its deadline. |
| `500` | `internal_error` | An unexpected server failure; details remain in structured logs. |

## Current security boundary

The API has no application-layer caller authentication. ADR-0014 explicitly
sets the V1 owner perimeter at the trusted Mac Mini account and authenticated
SSH session, and configuration rejects non-loopback listeners. SSH forwarding
may expose the loopback service to the owner's MacBook. Vera must not bind to a
LAN or public interface until application identity, authentication, and
transport policy are implemented.
