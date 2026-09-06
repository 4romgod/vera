# Vera Pocket TTS service

This is Vera's owner-controlled speech-synthesis process boundary. It exposes a
small Vera-owned HTTP contract on loopback and keeps Python and model-specific
code outside the TypeScript API.

The runtime is managed with `uv`; dependencies are pinned in `uv.lock`. CI uses
an isolated `.venv-test` with the deterministic engine and does not download
model weights or alter the production environment. The production service
loads Pocket TTS during startup and downloads its weights on first start.

```sh
# Install the locked neural engine runtime.
uv sync --directory services/pocket-tts --frozen --extra engine

# Run it through Vera's profile-aware wrapper.
VERA_PROFILE=ollama npm run dev:speech

# Run deterministic contract tests without model downloads.
npm run test:speech
```

The selected profile uses `POCKET_TTS_VOICE` for the default voice and
`POCKET_TTS_ALLOWED_VOICES` for the comma-separated catalog loaded by the
sidecar. The default catalog is `alba,anna`; every configured catalog must
include the default voice.

The service refuses non-loopback binds. Its public contract is:

- `GET /health` — process liveness.
- `GET /ready` — model readiness.
- `POST /v1/speech` — closed JSON input and mono WAV output.

Do not call this service from the frontend. Clients use Vera API `/v1/speech`,
which applies configuration, size limits, cancellation, and error mapping.
