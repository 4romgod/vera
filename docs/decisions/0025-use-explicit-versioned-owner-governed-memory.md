# ADR-0025: Use explicit, versioned, owner-governed long-term memory

**Status:** Accepted
**Date:** 26 August 2026

## Context

Vera can already retain conversation history and operational state, but neither
is long-term memory. Replaying every message would be unbounded, would mix
unrelated scopes, and could silently disclose personal information to a model.
Automatically extracting model inferences would also let a probabilistic model
write durable beliefs about the owner without informed consent.

Vera needs cross-conversation personalization to become a useful assistant,
while preserving provenance, correction, deletion, provider boundaries, and
the rule that models propose but code controls effects.

## Decision

Vera stores explicit owner-approved memory records in a logically separate
MongoDB `memories` collection. Memory is available through
`memory_management@1` with four closed actions: `remember`, `list`, `correct`,
and `forget`.

Every conversational memory action is proposed through the normal model
boundary and receives a separate approval. Mutations execute in Vera's
owner-controlled local-store adapter and produce a typed `memory_result`
artifact. Direct owner inspection through the authenticated deployment
perimeter is exposed separately as read-only API projection and cannot mutate
memory or bypass approval. A record contains:

- stable owner-scoped identity and a monotonically increasing revision;
- one of `fact`, `preference`, `instruction`, or `project_knowledge`;
- subject, content, global or exact-project scope, and sensitivity;
- owner-message task, conversation, message, and invocation provenance;
- immutable prior revisions for correction history; and
- active or forgotten state with mutation ordering for recovery.

Correction updates the stable record and appends the prior version to history,
up to a deterministic 100-revision-history ceiling. Vera rejects another
correction before it could create an unreadable record; the owner may forget
that record and create a replacement. Forget creates a durable tombstone rather
than pretending the record never existed. Active listing excludes tombstones;
an explicit audit listing may include them.

Before an owner-controlled orchestration-model call, Vera may freeze at most 20
active global and exact-project records totaling at most 12,000 characters.
The run stores entries and a manifest of identities, revisions, hashes, sizes,
scope, totals, limits, and exclusions. Vera reloads and validates every record
before disclosure and fails closed if any frozen record is stale, missing,
tampered, forgotten, or out of scope. Only the useful typed memory content—not
internal IDs or audit hashes—is sent to the model.

Third-party orchestration providers receive no long-term memory context. There
is no automatic fallback that weakens this boundary.

## Rationale

This makes memory inspectable, correctable, and explainable while keeping its
authority below the current owner message and system policy. Deterministic
scope and recency selection are sufficient for the present data size and are
easier to audit than semantic retrieval.

## Consequences

- Vera can personalize later conversations without replaying unrelated chat.
- The owner sees and approves exact durable memory effects.
- Corrections remain auditable and forgotten memories stop influencing models.
- A memory changed while a queued run is waiting invalidates that run's frozen
  context instead of silently changing its meaning.
- Cloud brains remain less personalized until a separate disclosure policy is
  accepted.
- MongoDB may host operational resources and memory, but their contracts,
  collection, lifecycle, and context policy remain separate.

## Alternatives considered

- **Treat all conversation history as memory:** rejected as unbounded,
  cross-scope, and difficult to correct or delete.
- **Automatically extract memories:** rejected because a model inference must
  not silently become durable personal state.
- **Use Redis or Markdown:** rejected because memory is durable, concurrent,
  queryable owner state, not a rebuildable scratchpad or document.
- **Introduce embeddings or a vector database immediately:** deferred because
  retrieval infrastructure is not the memory model and is unnecessary at the
  current scale.
- **Send memory to every configured provider:** rejected because provider
  selection must not silently broaden personal-data disclosure.

## Follow-up

- Define a separately approved cloud-memory disclosure policy if needed.
- Add retention and physical erasure policy before multi-user or regulated use.
- Consider semantic retrieval only after deterministic limits become a measured
  quality problem.
