# ADR-0027: Use Tailscale Serve for private physical-device access

**Status:** Accepted
**Date:** 26 August 2026

## Context

Vera's API deliberately listens only on loopback. That protects the
single-owner development system from the local network, but it also prevents a
physical phone from reaching the API used by the universal Expo frontend.

The owner's Mac Mini and phone are enrolled in the same private Tailscale
network. The owner wants tailnet membership—not a second application login—to
be the physical-device access boundary at this stage.

## Decision

Keep the Vera API bound to `127.0.0.1` and publish that listener through
Tailscale Serve's private HTTPS reverse proxy. Never bind Vera directly to a
LAN address or its Tailscale address.

For this single-owner deployment:

- a device may reach Vera remotely only when Tailscale and the tailnet policy
  permit it to reach the Mac Mini's Serve endpoint;
- all admitted requests continue to map to the internal `owner_v1` principal;
- Tailscale Funnel is forbidden because it makes the endpoint public;
- Tailscale Serve terminates HTTPS at the tailnet boundary, proxies `/` to the
  loopback Expo web server, and proxies `/api` to `http://127.0.0.1:4310`;
- the frontend receives the private
  `https://<mac-mini>.<tailnet>.ts.net/api` URL through
  `EXPO_PUBLIC_VERA_API_URL`; no secret enters the client bundle;
- no public Expo tunnel or Tailscale Funnel is used; and
- browser CORS remains loopback-only. The physical phone loads the frontend and
  API through the same private Tailscale HTTPS origin, so no remote browser
  origin is necessary.

Repository commands discover the Mac Mini's MagicDNS name from local Tailscale
state, configure and remove both Serve routes, verify the private API path, and
start Expo web on loopback with the correct API URL.

## Trust boundary

Tailnet enrollment and Tailscale network policy are authentication and
authorization for this deployment boundary. Vera does not independently
distinguish users or devices inside that admitted network. Consequently, every
device permitted to reach the Serve endpoint has the authority of `owner_v1`.

This is acceptable only while the tailnet and its access policy are controlled
as the owner's private device network. Before the endpoint is shared with
another person, a tagged automation device is admitted broadly, or Vera becomes
multi-user, Vera must add application-layer identity and authorization.

## Rationale

Tailscale Serve makes a loopback service available only inside a tailnet,
applies the tailnet's access rules, and supplies HTTPS without widening the
process listener. This preserves ADR-0014's code-enforced loopback invariant
and satisfies ADR-0026's physical-device follow-up with a small, explicit
deployment boundary.

## Consequences

- A physical phone can use the same Expo frontend and public API contract as
  web and simulators through its ordinary browser.
- Vera remains unreachable from the ordinary LAN and public internet.
- Tailnet membership is powerful: an admitted device can inspect data and
  submit approval-bearing commands as the owner.
- Revocation happens through Tailscale device removal or access policy.
- Local CLI and web development continue to use loopback directly.
- This decision does not claim general-purpose or multi-user authentication.

## Alternatives considered

- **Bind Vera to `0.0.0.0` or its Tailscale IP:** rejected because it weakens
  the enforced listener invariant and may expose the API through unintended
  interfaces.
- **Add a separate Vera login now:** deferred by owner direction; tailnet
  membership is sufficient for the current private device set.
- **Use Tailscale identity headers for per-user authorization:** deferred until
  Vera needs to distinguish multiple admitted identities.
- **Use Tailscale Funnel:** rejected because Funnel is public internet
  exposure.

## Operational invariants

- Run `tailscale serve`, never `tailscale funnel`.
- Verify `tailscale serve status` points only to loopback Expo on `/` and the
  loopback API on `/api`.
- Keep Vera's `HOST` at `127.0.0.1`.
- Remove lost or untrusted devices from the tailnet promptly.
- Disable the proxy with `npm run tailscale:serve:off` when remote access is not
  needed.

Tailscale's current Serve behavior and access-policy boundary are documented in
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) and
[Tailscale Grants](https://tailscale.com/docs/features/access-control/grants).
