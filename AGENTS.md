# Development workspace

## Source of truth and development — updated 29 October 2026

The Mac checkout at `/Users/narey/Projects/resonance` is the source of truth. Develop, build and verify changes there, then commit and push them to GitHub (`narey83/resonance`, `main`) for publication and distribution. Preserve local work; do not overwrite or reset it to match GitHub. Fetching for comparison is safe, but reconcile incoming changes deliberately rather than treating the remote as authoritative.

Use only the Mac checkout for development, builds and checks. Do not connect to, inspect, edit or sync the development-server checkout on `192.168.0.80` (`dev-laptop.local`, `lan-server`) unless the user explicitly requests server access again. Do not use VS Code Remote SSH, `bin/dev-server`, `bin/dev-remote`, or source-mirroring helpers for this workflow.

The user reports that the server runtime moved from Docker to native processes. Historical Compose instructions do not describe the active runtime. A Git push updates source control; it does not deploy or restart an application. Server deployment requires a separate explicit request and must not be inferred from a request to sync GitHub and the Mac.

Before changing or shipping code, read [`.agents/BUILD_AND_DEPLOY.md`](.agents/BUILD_AND_DEPLOY.md). For deployment, also read [`.agents/DEPLOYMENT.md`](.agents/DEPLOYMENT.md): it records the established live server and Pixel/Metro delivery workflow. A user request to deploy authorizes those established destinations; do not ask the user to repeat them. The server-access restrictions above still apply to unrelated development or synchronization work. Build affected targets locally and report concrete blockers. For web UI changes, exercise the changed interaction in a headless browser and inspect desktop and narrow/mobile viewports. Use authenticated state when needed; report browser or authentication blockers instead of claiming visual verification.

Preserve private configuration, credentials, dependencies, native projects, application state and database backups. Never print private configuration or credentials during diagnostics. Git synchronization does not include private runtime state or databases.

## Old server — off limits to agents

Do not connect to, inspect, edit, execute commands on, or manage the old server (`resonance-dev`, `192.168.0.254`) unless the user explicitly requests access to that server. This restriction applies to every agent, including delegated agents, and includes read-only SSH, logs, Docker commands, deployment tools, and automated helpers. Do not use the old server as a fallback when diagnosing the current system. Do not run `bin/dev-remote` or other helpers that target it. If runtime information is missing, use the Mac evidence available or ask the user; do not connect to either server without explicit authorization.

The old server still hosts the music share. The current application's existing SMB access may continue; that does not authorize agents to administer or inspect the old host. Its stopped Resonance containers are expected after cutover. Preserve its checkout, backups, SMB service and unrelated applications. PostgreSQL is a frozen rollback source for Resonance; do not resume writes there or remove it without user approval.

The Mac checkout supports web/backend development, native iOS/Android builds and local Expo Metro. Private `.dev/config.json` may still select a historical remote runtime: check its runtime selector before invoking `bin/dev` and do not invoke remote modes. Do not edit mirrored mobile source while a mirror is running.

`docker/REMOTE_DEVELOPMENT.md` and `.dev/migration/NOTES.md` document the historical server workflow. Keep CarPlay and Android Auto work deferred unless the user resumes it.
