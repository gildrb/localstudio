# Local Studio

Local-first self-hosted LLM inference, runtime inspection, OpenAI-compatible chat, and agents.

**[Download the signed, notarized, self-updating macOS Apple Silicon app](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-arm64.dmg)** · [Releases](https://github.com/sybil-solutions/local-studio/releases) · [Website](https://localstudio.ai)

Docs: [`controller/`](controller/README.md) (Bun/Hono API) · [`frontend/`](frontend/README.md) (Next.js, agents, Electron)

## Setup

Requires Bun 1.3.14+, Node 22.19+, Git. Local inference needs a Docker-passthrough GPU; macOS may use a remote controller.

```bash
bun run doctor
bun run setup
bun run dev:controller # http://127.0.0.1:8080
bun run dev            # http://localhost:3000/setup (second terminal)
```

Setup installs locked workspaces. `/setup` reports environment checks and model recommendations. SQLite state and weights (`LOCAL_STUDIO_MODELS_DIR`, default `/models`) remain local.

For a verified macOS install or upgrade, run `bash scripts/install-desktop-app.sh stable`; `dev`, `--no-backup`, and `--migrate-rollbacks` retain their focused workflows. Stable installs pin the release digest and signing team. A custom `LOCAL_STUDIO_RELEASE_DMG_URL` must be paired with `LOCAL_STUDIO_RELEASE_DMG_SHA256`.

## Runtime and agent security

Controller: model lifecycle, proxy, state, events. Configure: targets, models, integrations, controls. Docker recipes: vLLM, SGLang, exllamav3/TabbyAPI.

`/agent` embeds [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) for auth, settings, extensions, tools, providers, and JSONL. Session lookup: `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, Pi `sessionDir`; legacy sessions remain readable. Destinations are the models/providers/controllers returned by the agent models API.

New chats allow Pi `read`, `grep`, `find`, `ls`; Full access enables all session tools. Read only is an allowlist, not an OS sandbox; extensions are separate. Pi has host-user permissions; Tailscale protects the dashboard, not Pi.

## Production and remote access

```bash
bun run build
bun run start:controller # separate terminal
bun run start
```

Plain `next start` breaks SSE. Frontend: `127.0.0.1:4783`; `PORT`: 1024–65535. Paths stay under platform-delimited `WORKSPACE_ROOTS` (default: home), e.g. `WORKSPACE_ROOTS="$HOME:/Volumes/Projects"`.

```bash
cd frontend
ALLOWED_TAILSCALE_HOSTS=studio.example.ts.net bun run start
tailscale serve --bg http://127.0.0.1:4783
tailscale serve status
```

Use the intended tailnet and ACLs/grants; never Funnel. Serve persists but does not start the app; keep both active. No user service is installed. Trust comma-separated `ALLOWED_TAILSCALE_USERS` only on loopback behind Serve.

Controller defaults to loopback. Non-loopback `LOCAL_STUDIO_HOST` requires `LOCAL_STUDIO_API_KEY`; trusted LAN opt-out: `LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true`. Remote frontend: `BACKEND_URL` or `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`). Deploy via SSH/infrastructure. Installer: `launchd` or `systemd --user`, not a repository daemon.

## Mobile

[KittyLitter](https://kittylitter.app) mirrors sessions/activity on iOS/Android. In Settings, use **Copy KittyLitter pairing credential**; it is private, so share only with a trusted device. [Pairing guide](https://localstudio.ai/mobile). Requires Local Studio 2.9.0+, KittyLitter 1.6.0+.

## Validation and release

Run `bun run check`. Pre-push checks commits/frontend quality. From current `dev`, use a focused branch; omit secrets, artifacts, format-only rewrites; report checks; attach UI screenshots. See [AGENTS.md](AGENTS.md).

Successful `main` CI stores an unsigned exact-SHA macOS app. Semantic Release maps breaking → major, `feat` → minor, and configured conventional types → patch. Isolated signing notarizes/staples; each stage rechecks `origin/main`. Signing stages the DMG, updater files, website alias, checksums, and release manifest; publish creates the tag/release and uploads only staged assets. Never publish to npm or tag manually.

Built with [Pi](https://github.com/earendil-works/pi), [SGLang](https://github.com/sgl-project/sglang), and [vLLM](https://github.com/vllm-project/vllm). [Support](https://github.com/sybil-solutions/local-studio/issues) · [Private security report](https://github.com/sybil-solutions/local-studio/security/advisories/new) · [License](LICENSE).
