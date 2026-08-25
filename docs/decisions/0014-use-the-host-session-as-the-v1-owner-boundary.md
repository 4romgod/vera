# ADR-0014: Use the host session as the V1 owner boundary

**Status:** Accepted
**Date:** 25 August 2026

## Context

Vera V1 is a single-owner service on the owner's Mac Mini. The API currently
uses the internal principal `owner_v1` and does not authenticate individual
HTTP requests. Accepted security documentation nevertheless required an
authenticated owner boundary, while operating documentation described
application authentication as deferred. Calling both statements true without
defining the boundary would make V1 completion ambiguous and could encourage
unsafe network exposure.

The owner already reaches the Mac Mini through an authenticated operating-
system account and SSH. Normal API access is either on that host or through an
SSH/VS Code tunnel to its loopback listener.

## Decision

V1's authenticated owner perimeter is the trusted single-user host session:

- Vera runs under the owner's Mac Mini account;
- the host and other local processes are inside the V1 trusted deployment
  boundary;
- remote owner access is authenticated by SSH and reaches Vera through a
  loopback tunnel;
- the API listener is restricted in configuration to `127.0.0.1`, `::1`, or
  `localhost`; and
- Vera maps requests admitted through this perimeter to the explicit internal
  principal `owner_v1`.

This is deployment authentication, not application-layer authentication. Vera
must not claim that `owner_v1` proves the identity of an arbitrary HTTP caller.

Application authentication is mandatory before any of these changes:

- binding the API to a non-loopback address;
- placing it behind a network-accessible proxy;
- admitting untrusted local processes or host users;
- supporting multiple people, clients with different authority, or service
  principals; or
- treating a bearer of an API URL as an authenticated owner.

That future identity design must define principal issuance, remote transport,
credential storage, revocation, and migration from `owner_v1` before code is
implemented.

## Rationale

The decision matches the actual V1 deployment and establishes an authenticated
perimeter without inventing a premature application identity protocol. It also
turns the loopback requirement from documentation advice into validated
configuration. SSH supplies an established authenticated remote-access
boundary while Vera remains a private local service.

## Consequences

- V1 can satisfy its single-owner boundary only in this explicitly trusted
  topology.
- `HOST=0.0.0.0`, LAN addresses, and public bind addresses fail startup.
- A compromised process inside the trusted host boundary can call Vera; V1
  does not claim isolation from such a process.
- MacBook access continues through SSH or VS Code port forwarding.
- Application authentication remains a pre-exposure requirement and cannot be
  skipped by describing a remote deployment as personal.

## Alternatives considered

### Implement bearer-token authentication immediately

Deferred because token issuance, storage, rotation, client enrollment, and
remote trust have not been designed. A token string alone would hide rather
than resolve those questions.

### Treat loopback as authentication

Rejected. Loopback is a network reachability constraint, not caller identity.
The accepted boundary is the trusted host session plus authenticated SSH, with
that limitation stated explicitly.

### Allow non-loopback binding with a warning

Rejected because the current application cannot distinguish the owner from an
untrusted network caller. The safe behavior is to fail startup.

## Follow-up

- Design application identity before any broader exposure.
- Revisit the trusted-local-process assumption before installing untrusted
  plugins or running Vera on a shared host.
