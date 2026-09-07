# Run Vera Locally on macOS

**Status:** Active runbook

**Last validated:** 6 September 2026

**Supported host:** macOS 14 or newer; Apple Silicon is recommended for the
qualified local-model path

## Outcome

At the end of this runbook, a new operator can use Vera from a browser with:

- MongoDB as durable operational storage;
- Redis as the rebuildable execution scratchpad;
- the qualified Ollama orchestration model and attachment-vision model;
- owner-controlled recording through local whisper.cpp transcription;
- owner-controlled neural speech through Pocket TTS;
- hands-free voice transport through self-hosted LiveKit; and
- optional private phone access through Tailscale Serve.

The text-only stack does not require transcription, Pocket TTS, LiveKit, or
Tailscale. Start with the minimal stack when diagnosing a new machine, then add
the optional processes.

## Topology and ports

All backend listeners remain on loopback. Do not change these bindings to
`0.0.0.0` to make phone access work; use Tailscale Serve instead.

| Component | Required for | Listener | Started by |
|---|---|---|---|
| MongoDB | Every persistent run | `127.0.0.1:27017` | Docker Compose or Homebrew |
| Redis | Every persistent run | `127.0.0.1:6379` | Docker Compose or Homebrew |
| Ollama | Local orchestration and vision | `127.0.0.1:11434` | Ollama application/service |
| whisper.cpp | Local recording and live transcription | `127.0.0.1:8080` | `npm run dev:transcription` |
| Pocket TTS | Neural Read aloud and live replies | `127.0.0.1:8091` | `npm run dev:speech` |
| LiveKit | Hands-free live conversation | `127.0.0.1:7880` plus private tailnet transport | `npm run dev:livekit` |
| Vera API and workers | Every Vera client | `127.0.0.1:4310` | `VERA_PROFILE=ollama npm run dev` |
| Expo web frontend | Browser interface | `localhost:8081` | `npm run dev:web` or `npm run dev:phone` |

MongoDB is authoritative and must retain its data. Redis persistence is
deliberately disabled because its contents are reconstructed from MongoDB.

## Daily startup: already-provisioned machine

Use this section after completing the first-time setup once.

### 1. Start persistent infrastructure

Choose exactly one option.

Docker Compose:

```bash
npm run infra:up
```

Homebrew services:

```bash
brew services start mongodb-community@8.2
brew services start redis
```

### 2. Confirm Ollama is running

If the Ollama macOS application is installed, open it. If Ollama is installed
as a CLI-only service, keep this process running in its own terminal:

```bash
ollama serve
```

Confirm the qualified models exist:

```bash
ollama list
```

The list must include `vera-gpt-oss-20b-32k:latest` and `qwen3-vl:8b` for the
full local profile.

### 3. Start optional local media services

Open one terminal per enabled service:

```bash
npm run dev:transcription
```

```bash
VERA_PROFILE=ollama npm run dev:speech
```

```bash
npm run dev:livekit
```

Do not start a process whose feature remains disabled in `.env` or
`.env.ollama`. LiveKit requires local transcription. Pocket TTS is independent
of recording and LiveKit.

### 4. Start the API

```bash
VERA_PROFILE=ollama npm run dev
```

Wait for `Server listening at http://127.0.0.1:4310` and then complete the
[readiness checks](#verify-the-running-system).

### 5. Start one frontend path

For a browser on the same Mac:

```bash
npm run dev:web
```

Open `http://localhost:8081`.

For a phone on the same private tailnet:

```bash
npm run dev:phone
```

Open the private HTTPS URL printed by the command. This configures only Vera's
`/`, `/api`, and `/livekit` Tailscale Serve routes. Never enable Funnel.

## First-time machine setup

### 1. Install host prerequisites

Install Apple's command-line tools and Homebrew first:

```bash
xcode-select --install
```

Follow the current installation instructions at
[brew.sh](https://brew.sh/), then install the command-line dependencies:

```bash
brew tap mongodb/brew
brew install node git mongodb-community@8.2 redis uv whisper-cpp ffmpeg livekit gh
```

Install the Ollama macOS application using the
[official macOS instructions](https://docs.ollama.com/macos). It provides the
local server and `ollama` CLI. Install and connect the recommended standalone
[Tailscale macOS client](https://tailscale.com/docs/install/mac) only when
private phone access is required.

Vera's software-planning and software-change adapters also require an
authenticated Codex CLI. Install the CLI according to its current official
instructions, then authenticate both optional external tools:

```bash
codex login
gh auth login
```

These sessions give the configured adapters transport access; they do not
remove Vera's exact approval boundaries.

Verify the commands are discoverable:

```bash
node --version
npm --version
git --version
docker --version
uv --version
ollama --version
whisper-server --help
livekit-server --version
gh --version
codex --version
```

Node.js must be version 22 or newer and npm version 10 or newer. `docker` is
required only for the Docker Compose database path. When using Homebrew
MongoDB and Redis instead, verify `mongosh`, `mongodump`, `mongorestore`, and
`redis-cli`.

### 2. Install the repository dependencies

Clone the repository, enter its root, and install exactly the locked npm graph:

```bash
git clone https://github.com/4romgod/vera.git
cd vera
npm ci
```

Run the deterministic gate before adding machine-specific configuration:

```bash
npm run check
npm run build
```

The default gate does not download Ollama models or call paid providers.

### 3. Create local configuration

```bash
cp .env.example .env
cp .env.ollama.example .env.ollama
```

Both files are ignored by Git. Keep credentials and private machine paths only
in these uncommitted files.

The committed Ollama profile selects:

```dotenv
VERA_MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=vera-gpt-oss-20b-32k:latest
VERA_VISION_PROVIDER=ollama
OLLAMA_VISION_MODEL=qwen3-vl:8b
OLLAMA_THINK=medium
```

To enable the complete local media stack, set these values in `.env.ollama`:

```dotenv
VERA_TRANSCRIPTION_PROVIDER=whisper_cpp
WHISPER_CPP_BASE_URL=http://127.0.0.1:8080
WHISPER_CPP_MODEL=large-v3-turbo

VERA_SPEECH_PROVIDER=pocket_tts
POCKET_TTS_BASE_URL=http://127.0.0.1:8091
POCKET_TTS_VOICE=alba
POCKET_TTS_ALLOWED_VOICES=alba,anna

VERA_LIVE_VOICE_ENABLED=true
LIVEKIT_SERVER_URL=ws://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

The short LiveKit secret is permitted only for the foreground development
server. The installed background service requires a generated secret of at
least 32 characters.

If live conversation is not needed, leave `VERA_LIVE_VOICE_ENABLED=false`.
Recording still works when transcription is enabled. If neural speech is not
needed, leave `VERA_SPEECH_PROVIDER=disabled`; Vera then exposes device speech
as an explicit fallback instead of silently changing providers.

### 4. Provision the qualified Ollama models

Start Ollama, then pull the base model and build Vera's reproducible 32K alias:

```bash
ollama pull gpt-oss:20b
ollama create vera-gpt-oss-20b-32k -f config/ollama/vera-gpt-oss-20b-32k.Modelfile
ollama pull qwen3-vl:8b
```

Do not replace the committed Modelfile with an absolute model-blob path. The
checked file intentionally derives from the portable `gpt-oss:20b` tag.

Confirm both configured names are available:

```bash
ollama list
ollama show vera-gpt-oss-20b-32k:latest --modelfile
```

Then qualify structured output for this exact Ollama build and hardware:

```bash
VERA_PROFILE=ollama npm run test:model
```

This is a live local-model check and can take several minutes.

### 5. Provision local transcription

Install the model at the path expected by Vera:

```bash
mkdir -p ~/.vera/models/whisper
curl --fail --location \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin \
  --output ~/.vera/models/whisper/ggml-large-v3-turbo-q5_0.bin
```

Verify the checksum published by the
[whisper.cpp model catalog](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md):

```bash
printf '%s  %s\n' \
  e050f7970618a659205450ad97eb95a18d69c9ee \
  ~/.vera/models/whisper/ggml-large-v3-turbo-q5_0.bin \
  | shasum -a 1 -c -
```

Expected result:

```text
/Users/<owner>/.vera/models/whisper/ggml-large-v3-turbo-q5_0.bin: OK
```

### 6. Provision Pocket TTS

Install the locked Python environment from Vera's `uv.lock`:

```bash
uv sync --directory services/pocket-tts --frozen --extra engine
```

The first real sidecar start downloads model and voice weights. The configured
allowlist is the neural catalog returned to clients; the much larger browser
or operating-system voice list remains a separate fallback catalog.

### 7. Start databases

For portable development, install and start Docker Desktop, then run:

```bash
npm run infra:up
```

Alternatively, use native Homebrew services:

```bash
brew services start mongodb-community@8.2
brew services start redis
```

Never start both options together because they claim the same loopback ports.

Now return to [Daily startup](#daily-startup-already-provisioned-machine).

## Verify the running system

Do not begin functional testing until every enabled dependency passes.

### Infrastructure and models

For Homebrew services:

```bash
mongosh --quiet --eval 'db.adminCommand({ping:1})'
redis-cli ping
curl --silent http://127.0.0.1:11434/api/tags | jq '.models[].name'
```

For Docker Compose, use:

```bash
docker compose ps
```

MongoDB and Redis must both report healthy. The Redis CLI response is `PONG`.

### Optional media services

Run only the checks for enabled services:

```bash
curl --silent http://127.0.0.1:8091/health | jq
curl --silent http://127.0.0.1:8091/ready | jq
curl --silent http://127.0.0.1:8080/health | jq
```

Pocket TTS readiness must advertise every configured allowed voice. The
whisper.cpp response shape is owned by the installed version; the important
condition is a successful HTTP response before the API starts.

For LiveKit and phone routes:

```bash
npm run tailscale:status
```

### Vera public boundary

```bash
curl --silent http://127.0.0.1:4310/health | jq
curl --silent http://127.0.0.1:4310/ready | jq
curl --silent http://127.0.0.1:4310/v1/voice | jq
curl --silent http://127.0.0.1:4310/v1/speech | jq
```

`/health` proves the API process is alive. `/ready` is authoritative for its
configured dependencies and must return `"status": "ready"`. `/v1/voice`
reports whether live mode is enabled. `/v1/speech` reports the selected neural
provider, default voice, and bounded voice catalog when Pocket TTS is enabled.

Verify the frontend:

```bash
curl --silent http://localhost:8081 | head
```

Finally, open the UI, send `Reply with exactly: Vera is ready`, and confirm a
durable Vera reply appears. If speech is enabled, preview both Alba and Anna in
**Settings → Voice** and confirm that they sound different.

## Stop the development stack

Stop foreground terminals with `Ctrl-C` in this order:

1. frontend;
2. API;
3. LiveKit;
4. Pocket TTS;
5. whisper.cpp; and
6. a foreground `ollama serve`, if one was started manually.

Then disable private routes when they are no longer needed:

```bash
npm run tailscale:serve:off
```

Stop only the infrastructure option that was started.

Docker Compose:

```bash
npm run infra:down
```

This preserves the named MongoDB volume.

Homebrew services:

```bash
brew services stop redis
brew services stop mongodb-community@8.2
```

Do not delete MongoDB files or the Compose volume as a routine shutdown step.

## Next paths

- For persistent background operation, continue with the
  [installed Mac service runbook](installed-mac-service.md).
- For failed checks, use the [troubleshooting guide](troubleshooting.md).
- For a compiled MongoDB/Redis durability qualification, run
  `npm run verify:persistent` only after the ordinary stack is healthy.
- For a live orchestration-model qualification through compiled production
  code, run `VERA_PROFILE=ollama npm run verify:live-model` deliberately; it is
  not part of daily startup.
