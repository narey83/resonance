# Development workspace

## Source of truth and development — updated 30 October 2026

The Mac checkout at `/Users/narey/Projects/resonance` is the source of truth. Edit and manage source there, run builds and checks on the dev laptop under the standing rule below, then commit and push changes to GitHub (`narey83/resonance`, `main`) for publication and distribution. Preserve local work; do not overwrite or reset it to match GitHub. Fetching for comparison is safe, but reconcile incoming changes deliberately rather than treating the remote as authoritative.

**Standing user instruction, 30 October 2026: use the dev laptop until the user explicitly says Mac runtime use is OK.** The Mac checkout remains the source of truth for editing and Git. Run builds, automated checks, development servers and runtime QA on `dev-laptop.local` (`192.168.0.80`), using an isolated source snapshot so existing work and private state are preserved. Do not start a web, backend, Metro or temporary QA server on the Mac. Mac-side SSH/ADB transport, source control and file packaging are allowed; a local SSH forward is transport, not an application runtime. This supersedes older Mac-only build and local-Metro guidance. Do not use historical Docker helpers or automatic source-mirroring scripts.

The user reports that the server runtime moved from Docker to native processes. Historical Compose instructions do not describe the active runtime. A Git push updates source control; it does not deploy or restart an application. Server deployment requires a separate explicit request and must not be inferred from a request to sync GitHub and the Mac.

Before changing or shipping code, read [`.agents/BUILD_AND_DEPLOY.md`](.agents/BUILD_AND_DEPLOY.md). For deployment, also read [`.agents/DEPLOYMENT.md`](.agents/DEPLOYMENT.md): it records the established live server and Pixel/Metro delivery workflow. A user request to deploy authorizes those established destinations; do not ask the user to repeat them. Use the dev laptop for builds and runtime checks under the standing instruction above; old-server restrictions remain in force. Build affected targets there and report concrete blockers. For web UI changes, exercise the changed interaction in a headless browser and inspect desktop and narrow/mobile viewports. Use authenticated state when needed; report browser or authentication blockers instead of claiming visual verification.

Preserve private configuration, credentials, dependencies, native projects, application state and database backups. Never print private configuration or credentials during diagnostics. Git synchronization does not include private runtime state or databases.

## Old server — off limits to agents

Do not connect to, inspect, edit, execute commands on, or manage the old server (`resonance-dev`, `192.168.0.254`) unless the user explicitly requests access to that server. This restriction applies to every agent, including delegated agents, and includes read-only SSH, logs, Docker commands, deployment tools, and automated helpers. Do not use the old server as a fallback when diagnosing the current system. Do not run `bin/dev-remote` or other helpers that target it. If runtime information is missing, use the Mac evidence available or ask the user; do not connect to either server without explicit authorization.

The old server still hosts the music share. The current application's existing SMB access may continue; that does not authorize agents to administer or inspect the old host. Its stopped Resonance containers are expected after cutover. Preserve its checkout, backups, SMB service and unrelated applications. PostgreSQL is a frozen rollback source for Resonance; do not resume writes there or remove it without user approval.

Keep editing in the Mac source checkout, but use the dev laptop for build/test/application runtimes until the user explicitly permits otherwise. Metro must run on the dev laptop, with SSH/ADB forwarding to the connected Pixel if needed. An iOS native build requiring Mac/Xcode is blocked by this runtime restriction unless the user grants an exception. Private `.dev/config.json` and old helper scripts may still describe historical Docker/remote workflows; do not execute them as the current native runbook. Do not edit mirrored mobile source while a mirror is running.

`docker/REMOTE_DEVELOPMENT.md` and `.dev/migration/NOTES.md` document the historical server workflow. Keep CarPlay and Android Auto work deferred unless the user resumes it.
