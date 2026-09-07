# Install Vera as a macOS Background Service

**Status:** Active runbook

**Last validated:** 6 September 2026

**Scope:** One owner account on a dedicated or always-on Mac

## Outcome

This runbook installs compiled Vera under the current macOS user with
LaunchAgents for:

- Pocket TTS when `VERA_SPEECH_PROVIDER=pocket_tts`;
- LiveKit when `VERA_LIVE_VOICE_ENABLED=true`;
- the Vera API and workers;
- the static universal web frontend; and
- a daily compressed MongoDB backup.

MongoDB, Redis, Ollama, and Tailscale remain operator-owned host services. The
installer checks them but does not install or configure them. Local
whisper.cpp transcription is also not currently a Vera-managed LaunchAgent;
see [Local-transcription limitation](#local-transcription-limitation).

Use the [local-development runbook](local-development.md) first to provision
the machine, models, environment files, and dependencies.

## Installed topology

| Process | Owner | Startup behavior |
|---|---|---|
| MongoDB | Homebrew/operator | Must be ready before Vera |
| Redis | Homebrew/operator | Must be ready before Vera |
| Ollama | Ollama application/operator | Must be ready before Vera when selected |
| whisper.cpp | Operator | Required separately when local transcription is selected |
| Pocket TTS | `dev.vera.speech` | Installed only when selected |
| LiveKit | `dev.vera.livekit` | Installed only when live voice is enabled |
| Vera API | `dev.vera.api` | Always installed |
| Static frontend | `dev.vera.frontend` | Always installed |
| MongoDB backup | `dev.vera.backup` | Runs daily at 03:15 local time |

LaunchAgent definitions, logs, and backups are stored below `~/.vera`. Actual
environment files remain in the repository and are restricted to the owner.

## First installation

### 1. Start operator-owned dependencies

The installed path expects native host CLIs for readiness and backup work.
Start MongoDB and Redis through Homebrew:

```bash
brew services start mongodb-community@8.2
brew services start redis
```

Open the Ollama application or otherwise ensure its loopback server is running.
Connect Tailscale and verify that the host is online:

```bash
ollama list
tailscale status --peers=false
```

The configured orchestration and vision models must appear in `ollama list`.
Use the model-provisioning section of the
[local-development runbook](local-development.md#4-provision-the-qualified-ollama-models)
if they are absent.

### 2. Prepare the production profile

The installer requires both `.env` and the selected `.env.<profile>` file:

```bash
cp .env.example .env
cp .env.ollama.example .env.ollama
```

Review every enabled adapter before installation. The installed service uses
`VERA_STORAGE_MODE=persistent`; server-only credentials stay in these ignored
files. Do not place secrets in LaunchAgent files, public Expo variables, Git,
or command-line URLs.

For Pocket TTS, configure:

```dotenv
VERA_SPEECH_PROVIDER=pocket_tts
POCKET_TTS_BASE_URL=http://127.0.0.1:8091
POCKET_TTS_VOICE=alba
POCKET_TTS_ALLOWED_VOICES=alba,anna
```

For installed LiveKit, generate a non-development key/secret pair:

```bash
livekit-server generate-keys
```

Store the generated values in `.env.ollama` and use a private Tailscale URL:

```dotenv
VERA_LIVE_VOICE_ENABLED=true
LIVEKIT_SERVER_URL=ws://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=wss://<host>.<tailnet>.ts.net/livekit
LIVEKIT_API_KEY=<generated-key>
LIVEKIT_API_SECRET=<generated-secret-at-least-32-characters>
```

Do not reuse the `devkey`/`secret` development pair for installed operation.

### 3. Authenticate optional execution adapters

The current production doctor requires authenticated Codex and GitHub CLIs:

```bash
codex login status
gh auth status
```

Configure the Git author identity used by separately approved publication:

```bash
git config --global user.name
git config --global user.email
```

If either command prints nothing or fails, configure that identity before
continuing.

### 4. Build and run the production doctor

```bash
npm ci
npm run check
npm run build:install
VERA_PROFILE=ollama npm run vera:doctor
```

`vera:doctor` checks macOS, Node, environment files, configuration parsing,
MongoDB, Redis, Ollama, required executables, Codex authentication, GitHub
authentication, Tailscale, Git identity, Pocket TTS importability when enabled,
and compiled production artifacts. It is a verifier, not an installer.

Resolve every failure before continuing. Do not bypass a failed dependency by
changing persistent storage to memory or disabling a capability without an
operator decision.

### 5. Install and start Vera

```bash
VERA_PROFILE=ollama npm run vera:install
```

The command rebuilds install artifacts, installs the locked Pocket TTS runtime
when selected, writes owner-scoped LaunchAgents, starts them in dependency
order, and waits for Pocket TTS, API, and frontend readiness. It does not merge,
publish, or modify source control.

Configure the private HTTPS routes only after local readiness passes:

```bash
npm run tailscale:serve
npm run tailscale:status
```

Open the HTTPS URL shown by `tailscale:status`. Never enable Tailscale Funnel.

## Verify the installation

### Service manager

```bash
VERA_PROFILE=ollama npm run vera:status
```

Every configured Vera service should report loaded and its dependency endpoint
should report ready.

### Local endpoints

```bash
curl --silent http://127.0.0.1:4310/health | jq
curl --silent http://127.0.0.1:4310/ready | jq
curl --silent http://127.0.0.1:8081/_health | jq
```

When Pocket TTS is enabled:

```bash
curl --silent http://127.0.0.1:8091/ready | jq
curl --silent http://127.0.0.1:4310/v1/speech | jq
```

When live voice is enabled:

```bash
curl --silent http://127.0.0.1:4310/v1/voice | jq
npm run tailscale:status
```

`/ready` must return `"status": "ready"`. A healthy `/health` response alone
is insufficient because it does not prove model, persistence, or optional
provider readiness.

### Functional proof

Open Vera through its private HTTPS URL and:

1. send `Reply with exactly: installed Vera is ready`;
2. reload the page and confirm the conversation and reply remain;
3. preview each configured neural voice under **Settings → Voice**;
4. record and transcribe one message when transcription is enabled; and
5. start and end one live conversation when LiveKit is enabled.

## Ordinary operation

LaunchAgents start under the owner account. Use these explicit controls:

```bash
VERA_PROFILE=ollama npm run vera:status
VERA_PROFILE=ollama npm run vera:start
VERA_PROFILE=ollama npm run vera:restart
VERA_PROFILE=ollama npm run vera:stop
```

Inspect logs without printing environment files:

```bash
npm run vera:logs
```

Follow live logs with the default command or print a bounded snapshot:

```bash
npm run vera:logs -- --no-follow
```

## Backups

MongoDB is durable authority and receives a compressed backup every day at
03:15 local time. Redis is intentionally excluded.

Create and verify an on-demand backup:

```bash
VERA_PROFILE=ollama npm run vera:backup
VERA_PROFILE=ollama npm run vera:backup:verify
```

Backups are stored under `~/.vera/backups/mongodb`. Retention is controlled by
`VERA_BACKUP_RETENTION_DAYS` and defaults to 14 days. A backup is not proven
until restore verification succeeds.

## Updating after a reviewed merge

Use only from a clean local `main` after the pull request has been reviewed and
merged:

```bash
git switch main
git status --short
VERA_PROFILE=ollama npm run vera:update
```

`vera:update` fetches and requires a fast-forward-only `origin/main`, verifies
the exact candidate in an isolated worktree, builds production artifacts, and
restarts Vera only after verification succeeds. It does not create or merge a
pull request.

After updating, repeat `vera:status`, endpoint readiness, and the functional
proof appropriate to the change.

## Stop or uninstall

Stop Vera without removing service definitions:

```bash
VERA_PROFILE=ollama npm run vera:stop
```

Remove Vera's LaunchAgents while preserving source, environment files,
databases, logs, and backups:

```bash
VERA_PROFILE=ollama npm run vera:uninstall
```

Disable Vera's private routes separately:

```bash
npm run tailscale:serve:off
```

Stopping MongoDB is a separate operator decision. Never delete its data
directory or volume as part of routine Vera shutdown.

## Local-transcription limitation

The current installer does **not** create or supervise a whisper.cpp
LaunchAgent. If `VERA_TRANSCRIPTION_PROVIDER=whisper_cpp`, the operator must
start `npm run dev:transcription` before Vera and keep it alive. After a reboot,
that process must be started again before the API can become fully ready.

For unattended installed operation today, choose one of these explicit paths:

- configure the OpenAI transcription adapter and accept its declared
  third-party data boundary; or
- operate whisper.cpp with a separately reviewed host service outside Vera.

Do not document or present local transcription as Vera-managed until a future
increment adds its own supervised service definition, lifecycle checks, logs,
and tests.

For failures, continue with the [operator troubleshooting guide](troubleshooting.md).
