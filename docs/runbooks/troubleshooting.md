# Vera Operator Troubleshooting

**Status:** Active runbook

**Last validated:** 6 September 2026

Use this guide after following either the
[local-development](local-development.md) or
[installed-service](installed-mac-service.md) runbook. Diagnose from the
lowest dependency upward; an API symptom is often a database, model, or media
sidecar failure.

Never paste `.env` files, credentials, complete process environments, request
bodies, owner messages, or provider responses into issues or chat. Prefer the
bounded status commands below.

## Fast triage

Run from the repository root:

```bash
git status --short
node --version
npm --version
docker compose ps
ollama list
curl --silent http://127.0.0.1:4310/health | jq
curl --silent http://127.0.0.1:4310/ready | jq
```

For an installed service, add:

```bash
VERA_PROFILE=ollama npm run vera:status
npm run vera:logs -- --no-follow
```

Interpret the results in dependency order:

1. missing command or invalid version;
2. MongoDB or Redis unavailable;
3. selected model provider unavailable;
4. enabled transcription, speech, or LiveKit service unavailable;
5. API not listening;
6. frontend not listening or using the wrong API origin; and
7. Tailscale Serve route unavailable.

## Find a port conflict

Vera intentionally uses fixed loopback ports. Identify the owner before
stopping any process:

```bash
lsof -nP -iTCP:27017 -sTCP:LISTEN
lsof -nP -iTCP:6379 -sTCP:LISTEN
lsof -nP -iTCP:11434 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8091 -sTCP:LISTEN
lsof -nP -iTCP:7880 -sTCP:LISTEN
lsof -nP -iTCP:4310 -sTCP:LISTEN
lsof -nP -iTCP:8081 -sTCP:LISTEN
```

Do not kill an unidentified process. The usual conflict is running Docker
MongoDB/Redis and Homebrew MongoDB/Redis simultaneously. Stop only the option
you do not intend to use.

## Environment profile errors

### Selected profile does not exist

Symptom:

```text
Selected Vera environment profile "ollama" does not exist.
```

Fix:

```bash
cp .env.example .env
cp .env.ollama.example .env.ollama
```

Run profile-aware commands from the repository root. Vera resolves
`.env.<profile>` relative to that root and fails closed when it is absent.

### A setting appears to be ignored

Precedence is:

```text
launching shell > .env.<profile> > .env
```

Check whether the shell already exports the key:

```bash
printenv VERA_MODEL_PROVIDER
printenv OLLAMA_MODEL
printenv VERA_SPEECH_PROVIDER
```

Use `unset <NAME>` for an accidental shell override or deliberately pass the
override on the command invocation. Do not print all environment variables;
the complete environment can contain credentials.

## MongoDB

Symptom: `/ready` returns `operational_store_unavailable`, or startup reports
that an operational dependency is unavailable.

Check native MongoDB:

```bash
brew services info mongodb-community@8.2
mongosh --quiet --eval 'db.adminCommand({ping:1})'
```

Start it when using the Homebrew path:

```bash
brew services start mongodb-community@8.2
```

Check the Docker path:

```bash
docker compose ps mongodb
docker compose logs --tail=100 mongodb
```

Start the repository infrastructure when using Docker:

```bash
npm run infra:up
```

Do not remove `vera-mongodb-data`, delete the database directory, or change to
in-memory storage to conceal a readiness failure. MongoDB contains accepted
work, events, conversations, approvals, artifacts, and other operational
truth.

## Redis

Symptom: `/ready` reports `scratchpad_unavailable`.

```bash
redis-cli ping
```

Expected response:

```text
PONG
```

For Homebrew:

```bash
brew services info redis
brew services start redis
```

For Docker:

```bash
docker compose ps redis
docker compose logs --tail=100 redis
```

Redis state is disposable, but the service itself is required in persistent
mode. Restarting Redis may discard scratchpads; Vera must reconstruct them from
MongoDB.

## Ollama

### Ollama is not reachable

```bash
curl --silent http://127.0.0.1:11434/api/tags | jq
```

Open the Ollama macOS application or run `ollama serve` in a foreground
terminal. If another process owns port 11434, identify it with `lsof` before
taking action.

### Configured model is missing

```bash
ollama list
```

The qualified local profile requires:

- `vera-gpt-oss-20b-32k:latest` for orchestration; and
- `qwen3-vl:8b` for attachment vision.

Recreate them through the checked configuration:

```bash
ollama pull gpt-oss:20b
ollama create vera-gpt-oss-20b-32k -f config/ollama/vera-gpt-oss-20b-32k.Modelfile
ollama pull qwen3-vl:8b
```

### Structured-output conformance fails

Run the bounded diagnostic:

```bash
VERA_PROFILE=ollama npm run test:model
```

Confirm `.env.ollama` selects `OLLAMA_THINK=medium` for the qualified GPT-OSS
profile. Do not weaken schema validation or silently switch models. A newly
installed Ollama version or model revision must pass conformance before it is
trusted as Vera's orchestration brain.

## Pocket TTS

### Sidecar does not start

Verify `uv`, the locked environment, and the provider selection:

```bash
uv --version
uv sync --directory services/pocket-tts --frozen --extra engine
VERA_PROFILE=ollama npm run dev:speech
```

The first start may download model and voice weights. A Python import or model
download failure appears in the sidecar terminal or installed speech log.

### Settings still shows only one neural voice

Check the sidecar and API catalogs:

```bash
curl --silent http://127.0.0.1:8091/ready | jq '.voices'
curl --silent http://127.0.0.1:4310/v1/speech | jq '.voices'
```

`POCKET_TTS_ALLOWED_VOICES` is the sidecar catalog and must contain
`POCKET_TTS_VOICE`. After changing either value, restart Pocket TTS and then
refresh the Vera settings page.

The larger browser or operating-system list is **Device fallback**, not Pocket
TTS. Those voices can vary by browser and machine.

### Every neural option sounds the same

Verify that the selected item appears under **Neural speech**, not **Device
fallback**. The public API response includes `X-Vera-Speech-Voice`; an operator
can compare two bounded test files without exposing user text:

```bash
curl --silent --request POST http://127.0.0.1:4310/v1/speech \
  --header 'content-type: application/json' \
  --data '{"text":"This is the Alba verification voice.","voice":"alba"}' \
  --output /tmp/vera-alba.wav

curl --silent --request POST http://127.0.0.1:4310/v1/speech \
  --header 'content-type: application/json' \
  --data '{"text":"This is the Anna verification voice.","voice":"anna"}' \
  --output /tmp/vera-anna.wav
```

Both files must be valid WAV audio and should sound distinct. Remove these
operator-created temporary samples after listening.

## whisper.cpp transcription

### Model file is missing

The development wrapper expects:

```text
~/.vera/models/whisper/ggml-large-v3-turbo-q5_0.bin
```

Follow the provisioning and checksum steps in the
[local-development runbook](local-development.md#5-provision-local-transcription).

### Server command is missing

```bash
command -v whisper-server
brew list --versions whisper-cpp ffmpeg
```

Install missing packages with `brew install whisper-cpp ffmpeg`. Start the
service with:

```bash
npm run dev:transcription
```

Keep this foreground process alive. The current installed-service manager does
not supervise local whisper.cpp.

### Recording succeeds but transcription fails

Confirm the API profile selects `VERA_TRANSCRIPTION_PROVIDER=whisper_cpp`, the
base URL is loopback, and the whisper terminal remains running. Inspect the API
error code and the whisper terminal; do not persist or upload the recorded
audio as a debugging shortcut.

## LiveKit and hands-free voice

### Live voice is unavailable

Live voice requires all of these conditions:

- `VERA_LIVE_VOICE_ENABLED=true`;
- a configured, ready transcription provider;
- LiveKit listening at the private configured endpoint;
- matching API key and secret; and
- a development/preview native build when using React Native native modules.

Start the development server:

```bash
npm run dev:livekit
```

The foreground development credentials are `devkey` and `secret`. Installed
operation requires a generated secret of at least 32 characters.

Check Vera's public view:

```bash
curl --silent http://127.0.0.1:4310/v1/voice | jq
```

Expo Go cannot run Vera's native LiveKit mode. Use web or install Vera's
development/preview build.

### Live mode works locally but not on a phone

```bash
npm run tailscale:serve
npm run tailscale:status
```

Set `LIVEKIT_PUBLIC_URL` to the private `wss://.../livekit` URL reported by the
status command, restart the API, and refresh the client. Both devices must be
connected to the same tailnet.

## API

### `/health` works but `/ready` fails

This is expected when the process is alive but a configured dependency is not.
Read the sanitized `error.dependency` from `/ready`, repair that dependency,
and retry. Do not treat `/health` as sufficient readiness.

### API is not listening

For development, inspect the foreground terminal and restart with an explicit
profile:

```bash
VERA_PROFILE=ollama npm run dev
```

For installed operation:

```bash
VERA_PROFILE=ollama npm run vera:status
npm run vera:logs -- --no-follow
VERA_PROFILE=ollama npm run vera:restart
```

Do not expose the API directly on a LAN interface. It must remain on
`127.0.0.1:4310`.

## Frontend

### Browser opens but cannot reach the API

For local web, both services should use loopback:

```bash
curl --silent http://127.0.0.1:4310/health | jq
curl --silent http://localhost:8081 | head
```

For physical-phone web, use `npm run dev:phone`; do not open a raw Expo URL that
points the phone at its own `127.0.0.1`. The private Tailscale origin proxies
both page and API.

### UI appears stale after a source change

Use the in-app refresh first. If the bundle is stale, stop and restart
`npm run dev:web`. For installed operation, rebuild/reinstall or use the
reviewed `vera:update` path; the installed frontend is static and does not
hot-reload source.

## Tailscale Serve

Check the exact routes:

```bash
npm run tailscale:status
```

Expected Vera-owned paths are:

- `/` → `http://localhost:8081`;
- `/api` → `http://127.0.0.1:4310`; and
- `/livekit` → `http://127.0.0.1:7880`.

The helper refuses to overwrite conflicting paths. Resolve ownership of a
conflict rather than forcing it. To remove only Vera's expected configuration:

```bash
npm run tailscale:serve:off
```

Never enable Funnel.

## Installed LaunchAgents

`vera:status` is the first source of truth:

```bash
VERA_PROFILE=ollama npm run vera:status
```

If one service repeatedly restarts, inspect its bounded log:

```bash
npm run vera:logs -- --no-follow
```

Common causes are an executable path changed by a package-manager upgrade, an
unavailable external dependency, a missing model, or a profile change that was
not followed by `vera:install`. Rerun:

```bash
npm run build:install
VERA_PROFILE=ollama npm run vera:doctor
```

Only reinstall after the doctor passes:

```bash
VERA_PROFILE=ollama npm run vera:install
```

## Escalation evidence

When the runbook does not resolve the problem, collect only:

- the command that failed;
- its exit code and sanitized error;
- `git status --short`;
- the relevant `vera:status` row;
- the failing `/ready` dependency code;
- the owner of the affected loopback port; and
- bounded logs that exclude secrets and owner content.

Do not attach databases, Redis dumps, `.env` files, model caches, full logs, or
conversation payloads by default.
