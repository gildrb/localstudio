# Frontend

Shared Next.js 16/React 19 web UI and macOS Electron app.

## Routes

`/` controller/hardware · `/models` models · `/agent` Workbench, panes, Pi, terminals, browser, files, skills, extensions · `/agent/automations` automations · `/configure` machines/models/integrations/server · `/usage` usage · `/settings` app settings · `/logs` controller logs · `/setup` onboarding · `/quick` quick panel · `/access` web authentication

Redirects: `/discover`, `/recipes` → `/models`; `/integrations`, `/server` → Configure. Link canonical routes.

## Architecture

Electron/browser share Next routes/raw controller proxies. `services/agent-runtime/` executes Pi/browser-host routes; Next proxies them with `shared/agent/` shapes.

Global/Tailwind: `src/app/globals.css` · StyleX shell: `src/features/studio-shell.tsx` · config: `babel.config.js`, `postcss.config.mjs`

## Development and desktop

Use root [setup](../README.md#setup); controller default: `http://localhost:8080`. In `frontend/`: `bun run build`, `start`, `typecheck`, `typecheck:desktop`, `lint`, `check:quality`. Plain `next start` breaks streaming.

Desktop: `bun run desktop:build:main`, `desktop:start`, `desktop:pack`, `desktop:dist`. Pack is unpacked; dist makes DMG, updater ZIP, blockmap, metadata, with configured signing when available. `desktop:dist:notarized` notarizes locally. Release CI starts unsigned before isolated signing. Install: `/Applications/Local Studio.app`; id: `org.local.studio.desktop`.

## Controller connection

`shared/agent/backend-url.ts`: `BACKEND_URL` → `NEXT_PUBLIC_API_URL` → `NEXT_PUBLIC_BACKEND_URL`. Desktop preferences keep URLs local, credentials out of the controller database.

## Code map

`src/app/` route/API shells · `src/features/`, `studio*.ts(x)` features/composition · `src/lib/`, `src/hooks/` shared · `desktop/` Electron/resources/signing/packaging
