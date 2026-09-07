# Vera Operator Runbooks

**Status:** Active operator documentation

**Last updated:** 6 September 2026

These runbooks are the executable handoff path for operating Vera. Product and
architecture documents explain why the system exists; runbooks explain how to
bring the implemented system up safely and prove that it is healthy.

## Choose the right runbook

| Goal | Runbook |
|---|---|
| Provision a macOS development host and run Vera from source | [Local development](local-development.md) |
| Install compiled Vera as owner-scoped macOS background services | [Installed Mac service](installed-mac-service.md) |
| Diagnose a failed dependency, startup, voice, phone, or service check | [Troubleshooting](troubleshooting.md) |

The local-development runbook is the primary onboarding path. It covers both a
minimal text assistant and the complete owner-controlled stack: persistent
storage, Ollama, vision, transcription, Pocket TTS, LiveKit, API, frontend, and
private phone access.

## Operating rules

- Run commands from the repository root unless a step says otherwise.
- Keep the API, databases, model servers, transcription, and TTS bound to
  loopback. Physical devices enter through private Tailscale Serve routes.
- Never use Tailscale Funnel for Vera.
- Never commit `.env`, `.env.<profile>`, credentials, generated LiveKit secrets,
  downloaded model weights, or operator policy files containing private paths.
- MongoDB is durable operational truth. Do not remove its volume or data
  directory as a routine reset. Redis is disposable and reconstructible.
- Start only one MongoDB and Redis implementation at a time: Docker Compose or
  Homebrew services, never both on the same ports.
- A successful process launch is not readiness. Complete the verification
  section in the selected runbook.
