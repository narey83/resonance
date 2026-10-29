# Development workspace

## Current system — verified 27 October 2026

The active Resonance system is `192.168.0.80` (`dev-laptop.local`), reached from the Mac with `ssh lan-server`. The authoritative checkout is `/home/narey/projects/resonance` on that host. Inspect and edit that checkout directly, preserving uncommitted work.

The live deployment is the portable stack, Compose project `resonance-stack`, with `resonance-backend` and `resonance-frontend`. The frontend includes Caddy; there is no separate active `resonance-caddy` container. The active Compose files are `docker/compose.portable.yml`, `docker/compose.host-network.yml` and `docker/compose.tls.yml`. See `docker/PORTABLE_STACK.md` for the current workflow. Source changes require the appropriate image rebuild/deployment; this is not the old bind-mounted development stack.

Before changing or shipping code, read [`.agents/BUILD_AND_DEPLOY.md`](.agents/BUILD_AND_DEPLOY.md). A code task is not complete until each affected human-test target has been built and made available, or a concrete platform blocker has been reported.

For every web UI change, use a headless browser after deployment to exercise the changed interaction and visually inspect the live result at desktop and narrow/mobile viewport sizes. Unit tests, production builds and HTTP status checks do not replace this browser QA. Use an authenticated browser state when the route requires sign-in; if browser tooling or authentication is unavailable, report that as a concrete verification blocker instead of claiming the UI is visually verified.

Persistent application state is local to the new host at `/home/narey/.local/share/resonance-stack`, mounted as `/config` in the backend. SQLite is live under that state directory's `data/`; do not mistake the checkout's `backend/data` or an old conversion snapshot for the active database. Music is mounted over SMB at `/downloads`. Preserve native projects, credentials, dependencies, application state and database backups. Never print private configuration or credentials during diagnostics.

## Old server — off limits to agents

Do not connect to, inspect, edit, execute commands on, or manage the old server (`resonance-dev`, `192.168.0.254`) unless the user explicitly requests access to that server. This restriction applies to every agent, including delegated agents, and includes read-only SSH, logs, Docker commands, deployment tools, and automated helpers. Do not use the old server as a fallback when diagnosing the current system. Do not run `bin/dev-remote` or other helpers that target it. If current-system information is missing, inspect `lan-server` or ask the user.

The old server still hosts the music share. The current application's existing SMB access may continue; that does not authorize agents to administer or inspect the old host. Its stopped Resonance containers are expected after cutover. Preserve its checkout, backups, SMB service and unrelated applications. PostgreSQL is a frozen rollback source for Resonance; do not resume writes there or remove it without user approval.

The Mac checkout supports native iOS/Android builds and local Expo Metro. Its existing `bin/dev-remote` and `.dev/config.json` still describe the old development setup; do not use them to manage or diagnose the current portable stack until they are explicitly updated. Do not edit mirrored mobile source while a mirror is running.

`docker/REMOTE_DEVELOPMENT.md` and `.dev/migration/NOTES.md` document the historical server workflow. Keep CarPlay and Android Auto work deferred unless the user resumes it.
